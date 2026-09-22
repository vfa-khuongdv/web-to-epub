import { Router } from "express";
import { htmlToBlocks } from "../services/chapterHtml";
import { t } from "../services/lang";
import { StoredChapter } from "../types";
import { libraryFor } from "./library";

export const chaptersRouter = Router();

// One chapter's content, fetched when user opens it to view/edit.
chaptersRouter.get("/stories/:id/chapters/:order", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: t("Invalid chapter order") });
    return;
  }
  const chapter = await library.stories.getChapter(req.params.id, order);
  if (!chapter) {
    res.status(404).json({ message: t("Chapter not found") });
    return;
  }
  res.json({ chapter });
});

// Edit chapter title and content. Crawled content often mixes junk from the source site
// (web frame, ads, repeated chapter name), so user cleans it in the editor and saves
// to override the fetched version.
chaptersRouter.patch("/stories/:id/chapters/:order", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { id } = req.params;
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: t("Invalid chapter order") });
    return;
  }
  // Active crawl will overwrite the chapter with newly extracted content, so block edits
  // to prevent user losing work after cleaning it up.
  if (library.runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling, cannot edit chapters") });
    return;
  }

  const chapter = await library.stories.getChapter(id, order);
  if (!chapter) {
    res.status(404).json({ message: t("Chapter not found") });
    return;
  }

  const { title, contentHtml } = req.body as { title?: string; contentHtml?: string };
  if (!title?.trim()) {
    res.status(400).json({ message: t("Chapter title is required") });
    return;
  }
  if (typeof contentHtml !== "string") {
    res.status(400).json({ message: t("Chapter content is required") });
    return;
  }

  const blocks = htmlToBlocks(contentHtml);
  if (blocks.length === 0) {
    res.status(400).json({ message: t("Chapter content cannot be empty") });
    return;
  }

  // A failed crawl where user manually pastes content is marked done: it counts toward
  // the book and "Continue crawl" won't re-crawl and overwrite it.
  const updated: StoredChapter = {
    ...chapter,
    title: title.trim(),
    blocks,
    status: "done",
    error: undefined,
    errorKind: undefined,
  };
  await library.stories.saveChapter(id, updated);
  res.json({ chapter: updated });
});

// Correct a chapter's source URL without touching its content or status: the site itself
// can serve a chapter number wrong (a stale TOC entry, a broken slug) — this lets the user
// point the chapter at the right page, then use the existing Retry to re-crawl it.
chaptersRouter.patch("/stories/:id/chapters/:order/url", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { id } = req.params;
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: t("Invalid chapter order") });
    return;
  }
  // Same reasoning as the content edit above: an active crawl would overwrite this.
  if (library.runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling, cannot edit chapters") });
    return;
  }

  const chapter = await library.stories.getChapter(id, order);
  if (!chapter) {
    res.status(404).json({ message: t("Chapter not found") });
    return;
  }

  const { url } = req.body as { url?: string };
  const trimmed = url?.trim();
  if (!trimmed) {
    res.status(400).json({ message: t("Chapter URL is required") });
    return;
  }
  try {
    new URL(trimmed);
  } catch {
    res.status(400).json({ message: t("Chapter URL is not a valid URL") });
    return;
  }

  const updated: StoredChapter = { ...chapter, url: trimmed };
  await library.stories.saveChapter(id, updated);
  res.json({ chapter: updated });
});

// Correct a chapter's title without requiring content — the TOC-derived name can be
// wrong or garbled on the source site, and the user should be able to fix it before the
// chapter is even crawled, not just after. Status/blocks/url are untouched, so this works
// the same for a pending chapter as for one already crawled.
chaptersRouter.patch("/stories/:id/chapters/:order/title", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { id } = req.params;
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: t("Invalid chapter order") });
    return;
  }
  // Same reasoning as the content edit above: an active crawl would overwrite this.
  if (library.runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling, cannot edit chapters") });
    return;
  }

  const chapter = await library.stories.getChapter(id, order);
  if (!chapter) {
    res.status(404).json({ message: t("Chapter not found") });
    return;
  }

  const { title } = req.body as { title?: string };
  const trimmed = title?.trim();
  if (!trimmed) {
    res.status(400).json({ message: t("Chapter title is required") });
    return;
  }

  const updated: StoredChapter = { ...chapter, title: trimmed };
  await library.stories.saveChapter(id, updated);
  res.json({ chapter: updated });
});
