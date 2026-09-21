import { Router } from "express";
import { MAX_ATTEMPTS, estimateRemainingMs, extractWithRetry } from "../services/crawl";
import { chaptersToCrawl, pickChapterTitle } from "../services/storyService";
import { t } from "../services/lang";
import { ProgressEvent, StoredStory } from "../types";
import { libraryFor } from "./library";
import { publish } from "./live";

export const crawlRouter = Router();

crawlRouter.post("/stories/:id/crawl", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { id } = req.params;
  // Use getOutline not get: the loop below only needs url/order/status, while get()
  // parses content for every crawled chapter — a story with hundreds of chapters is
  // tens of MB sitting in RAM for the whole crawl unused.
  const story: StoredStory | undefined = await library.stories.getOutline(id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  if (library.runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling") });
    return;
  }

  const orders = Array.isArray((req.body as { orders?: number[] })?.orders)
    ? (req.body as { orders: number[] }).orders
    : undefined;
  const plan = chaptersToCrawl(story, orders);

  // Return immediately and crawl in background: progress is pushed via the live channel
  // so the requesting session (and any other sessions viewing this story) sees updates
  // in real time, even after reload.
  res.status(202).json({ started: true, total: plan.length });

  const send = (event: ProgressEvent) => publish(library, id, event);

  const startedAt = Date.now();
  library.runningCrawls.set(id, { cursor: 0, total: plan.length, startedAt });
  try {
    // Cover is downloaded only once (subsequent crawls skip because file exists): stories
    // created before this feature will get their cover on the next "Continue crawl".
    const savedCover = await library.covers.save(id, story.coverUrl, story.storyUrl);
    if (savedCover && savedCover !== story.coverUrl) {
      story.coverUrl = savedCover;
      // Re-read before saving: user may have just clicked "Save metadata" during crawl —
      // don't overwrite with the stale in-memory copy.
      const fresh = await library.stories.get(id);
      if (fresh) {
        await library.stories.updateMeta(id, {
          title: fresh.title,
          author: fresh.author,
          language: fresh.language,
          coverUrl: savedCover,
        });
      }
    }

    for (let i = 0; i < plan.length; i++) {
      // Before chapter i completes, completed count is i — ETA keeps the previous chapter's
      // estimate until we have new data.
      library.runningCrawls.set(id, {
        cursor: i + 1,
        total: plan.length,
        startedAt,
        etaMs: estimateRemainingMs({ startedAt, completed: i, total: plan.length }),
      });
      const chapter = plan[i];
      const extracted = await extractWithRetry(chapter.url, (attempt) => {
        const attemptSuffix = attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : "";
        send({ type: "progress", index: i, cursor: i + 1, total: plan.length, url: chapter.url, message: t("Loading & extracting…{attempt}", { attempt: attemptSuffix }) });
      });

      const stored = story.chapters.find((c) => c.order === chapter.order);
      if (stored) {
        stored.status = extracted.error ? "error" : "done";
        stored.error = extracted.error;
        stored.errorKind = extracted.error ? extracted.errorKind : undefined;
        stored.blocks = extracted.error ? undefined : extracted.blocks;
        if (!extracted.error) stored.title = pickChapterTitle(stored.title, extracted.title, stored.url);
        await library.stories.saveChapter(story.id, stored);
        // Release content after saving: `stored` lives in story.chapters so holding it means
        // keeping the entire story in memory until crawl completes.
        stored.blocks = undefined;
      }

      const etaMs = estimateRemainingMs({ startedAt, completed: i + 1, total: plan.length });
      if (extracted.error) {
        send({ type: "error", index: i, cursor: i + 1, total: plan.length, url: chapter.url, message: extracted.error, etaMs });
      } else {
        // Report which chapter just finished instead of letting the UI guess.
        send({ type: "chapter-done", index: i, cursor: i + 1, total: plan.length, url: chapter.url, etaMs });
      }
    }
    send({ type: "done", total: plan.length });
  } catch (err) {
    // Express 4 doesn't catch promise rejections in async handlers — handle manually
    // so a mid-crawl error (e.g., save failed) doesn't crash the process.
    const message = err instanceof Error ? err.message : "Unknown crawl error";
    publish(library, id, { type: "error", message });
  } finally {
    library.runningCrawls.delete(id);
    publish(library, id, { type: "idle" });
  }
});
