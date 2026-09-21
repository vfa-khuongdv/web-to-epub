import multer from "multer";
import os from "os";
import { Router } from "express";
import { findSupportedSite } from "../config/supportedSites";
import { settingsStore } from "../services/settingsStore";
import { storyId } from "../services/storyStore";
import { countNewChapters, mergeStory } from "../services/storyService";
import { getTocAdapter } from "../services/toc";
import { TocAdapter } from "../services/toc/types";
import { t } from "../services/lang";
import { StoredStory } from "../types";
import { Library, libraryFor } from "./library";

export const storiesRouter = Router();

const upload = multer({ dest: os.tmpdir() });

// Load TOC and save story — used by both POST /stories (create/update from URL)
// and POST /stories/:id/refresh (the "Load N new chapters" button).
async function refreshStoryToc(params: {
  library: Library;
  existing?: StoredStory;
  storyUrl: string;
  site: string;
  adapter: TocAdapter;
}): Promise<StoredStory> {
  const library = params.library;
  const toc = await params.adapter.fetchToc(params.storyUrl);
  const story = mergeStory({ existing: params.existing, site: params.site, storyUrl: params.storyUrl, toc });
  // A story being added for the first time starts from the defaults on the settings
  // page; reloading the TOC of one already in the library must not write over what the
  // reader saved on it, so only a new story is filled in.
  if (!params.existing) {
    const defaults = settingsStore.get();
    story.language ??= defaults.defaultBookLanguage;
    story.author ??= defaults.defaultAuthor || undefined;
  }
  // Download cover to data/covers/ once we know the story URL; if download fails, keep
  // the original URL so epub-gen can fetch it during export.
  const savedCover = await library.covers.save(story.id, story.coverUrl, params.storyUrl);
  if (savedCover) story.coverUrl = savedCover;
  await library.stories.save(story);
  return story;
}

storiesRouter.post("/stories", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ message: t("url is required") });
    return;
  }
  const site = findSupportedSite(url);
  if (!site) {
    res.status(400).json({ message: t("This site is not yet supported: {url}", { url }) });
    return;
  }
  const adapter = getTocAdapter(url);
  if (!adapter) {
    res.status(400).json({
      message: t("{site} does not yet support automatic chapter list loading", { site: site.name }),
    });
    return;
  }

  const storyUrl = adapter.normalizeStoryUrl(url);
  const id = storyId(storyUrl);
  if (library.runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling, cannot update chapter list") });
    return;
  }
  try {
    const existing = await library.stories.get(id);
    const story = await refreshStoryToc({ library, existing, storyUrl, site: site.domain, adapter });
    // User just manually loaded TOC: the "N new chapters" chip from the previous check
    // is now stale (new chapters became pending).
    await library.stories.setCheckResult(id, { newChapterCount: 0, checkedAt: new Date().toISOString(), error: null });
    res.json({ story });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : "Failed to load chapter list" });
  }
});

storiesRouter.get("/stories", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  res.json({ stories: await library.stories.list() });
});

// Chapter list without content: a story with thousands of crawled chapters weighs tens
// of MB if sent with blocks, but the chapter table only needs title + status. Individual
// chapter content is fetched separately via /stories/:id/chapters/:order.
storiesRouter.get("/stories/:id", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  res.json({ story });
});

// Downloaded cover image for the preview; if no cover exists, return 404 so
// frontend shows an empty placeholder instead of a broken image.
storiesRouter.get("/stories/:id/cover", (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const cover = library.covers.find(req.params.id);
  if (!cover) {
    res.status(404).json({ message: t("No cover image for this story") });
    return;
  }
  res.type(cover.contentType);
  res.sendFile(cover.filePath);
});

// Save book metadata edited by user in the detail panel (multipart because a new
// cover image may be included). Does not touch chapters, so can save mid-crawl.
storiesRouter.post("/stories/:id/meta", upload.single("cover"), async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { id } = req.params;
  const story = await library.stories.get(id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const { title, author, language } = req.body as { title?: string; author?: string; language?: string };
  if (!title?.trim()) {
    res.status(400).json({ message: t("Book title is required") });
    return;
  }

  let coverUrl = story.coverUrl;
  if (req.file) {
    const savedCover = await library.covers.saveUpload(id, req.file.path);
    if (!savedCover) {
      res.status(400).json({ message: t("Invalid cover file — only JPG, PNG, WebP, or GIF accepted") });
      return;
    }
    coverUrl = savedCover;
  }

  await library.stories.updateMeta(id, {
    title: title.trim(),
    author: author?.trim() || undefined,
    language: language?.trim() || undefined,
    coverUrl,
  });
  res.json({ story: await library.stories.getOutline(id) });
});

storiesRouter.post("/cover-upload", upload.single("cover"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: t("Cover file is required") });
    return;
  }
  res.json({ path: req.file.path });
});

// Enable/disable watching for new chapters of a story.
storiesRouter.post("/stories/:id/watch", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { id } = req.params;
  const { watching } = req.body as { watching?: unknown };
  if (typeof watching !== "boolean") {
    res.status(400).json({ message: t("watching must be true or false") });
    return;
  }
  const story = await library.stories.getOutline(id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  await library.stories.setWatching(id, watching);
  res.json({ story: await library.stories.getOutline(id) });
});

// Check current TOC to see if the story has new chapters. Only counts and saves result —
// doesn't add chapters to library; user clicks "Load N new chapters" to actually load
// them (via /stories/:id/refresh).
storiesRouter.post("/stories/:id/check", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { id } = req.params;
  const story = await library.stories.getOutline(id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const adapter = getTocAdapter(story.storyUrl);
  if (!adapter) {
    res.status(400).json({ message: t("This story has no TOC adapter for checking") });
    return;
  }
  if (library.runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling") });
    return;
  }

  try {
    const toc = await adapter.fetchToc(story.storyUrl);
    const newChapterCount = countNewChapters(story.chapters, toc.chapters);
    const checkedAt = new Date().toISOString();
    await library.stories.setCheckResult(id, { newChapterCount, checkedAt, error: null });
    res.json({ newChapterCount, lastCheckedAt: checkedAt, checkError: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not check for new chapters";
    // Keep previous new chapter count and last successful check; just record this error
    // so the UI can show a warning.
    await library.stories.setCheckResult(id, { error: message });
    res.status(502).json({ message });
  }
});

// Reload TOC for existing story: old chapters keep their content/status, new ones become
// pending. Used by the "Load N new chapters" button in story detail.
storiesRouter.post("/stories/:id/refresh", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { id } = req.params;
  const existing = await library.stories.get(id);
  if (!existing) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const site = findSupportedSite(existing.storyUrl);
  const adapter = getTocAdapter(existing.storyUrl);
  if (!site || !adapter) {
    res.status(400).json({ message: t("This story has no TOC adapter") });
    return;
  }
  if (library.runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling, cannot update chapter list") });
    return;
  }

  try {
    const story = await refreshStoryToc({
      library,
      existing,
      storyUrl: existing.storyUrl,
      site: site.domain,
      adapter,
    });
    await library.stories.setCheckResult(id, { newChapterCount: 0, checkedAt: new Date().toISOString(), error: null });
    res.json({ story });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : "Failed to load chapter list" });
  }
});

storiesRouter.delete("/stories/:id", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  if (library.runningCrawls.has(req.params.id)) {
    res.status(409).json({ message: t("Story is currently crawling, cannot delete") });
    return;
  }
  const removed = await library.stories.remove(req.params.id);
  if (!removed) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  await library.covers.remove(req.params.id);
  res.json({ ok: true });
});
