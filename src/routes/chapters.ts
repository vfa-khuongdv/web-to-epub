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
