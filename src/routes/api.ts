import { randomUUID } from "crypto";
import { Response as ExpressResponse, Router } from "express";
import multer from "multer";
import os from "os";
import path from "path";
import { MAX_ATTEMPTS, estimateRemainingMs, extractWithRetry } from "../services/crawl";
import { createCoverStore, coverPathForExport } from "../services/coverStore";
import { BuildProgress, buildEpub, contentDisposition, epubFileName } from "../services/epubBuilder";
import { findSupportedSite, SUPPORTED_SITES } from "../config/supportedSites";
import { DATA_DIR } from "../config/paths";
import { HIGHLIGHT_COLORS, HighlightColor, storyId, storyStore } from "../services/storyStore";
import { blocksToHtml, htmlToBlocks } from "../services/chapterHtml";
import { chaptersToCrawl, countNewChapters, mergeStory, pickChapterTitle } from "../services/storyService";
import { setLang, t } from "../services/lang";
import { getTocAdapter } from "../services/toc";
import { TocAdapter } from "../services/toc/types";
import {
  BookMetadata,
  ExportChapter,
  ExportRequest,
  ExtractedChapter,
  ExtractRequest,
  ProgressEvent,
  StoredChapter,
  StoredStory,
} from "../types";

const router = Router();

// The frontend states the reader's language on every request; the server phrases its
// errors in it (see services/lang.ts for why this is module state, not per-request).
router.use((req, _res, next) => {
  setLang(req.header("X-Lang") ?? undefined);
  next();
});
const upload = multer({ dest: os.tmpdir() });
const coverStore = createCoverStore(DATA_DIR);

router.get("/supported-sites", (_req, res) => {
  res.json({ sites: SUPPORTED_SITES });
});

// Returns hostnames (without protocol) that aren't in the supported-site
// allowlist, or null if every URL is supported.
function findUnsupportedUrls(urls: string[]): string[] | null {
  const unsupported = urls.filter((url) => !findSupportedSite(url));
  return unsupported.length > 0 ? unsupported : null;
}

// Streams NDJSON progress events (one JSON object per line) while crawling
// each chapter URL sequentially, so the frontend can show a progress bar
// without holding a long-lived request open per chapter.
router.post("/extract", async (req, res) => {
  const { urls } = req.body as ExtractRequest;
  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ message: t("urls is required and must be a non-empty array") });
    return;
  }

  const unsupported = findUnsupportedUrls(urls);
  if (unsupported) {
    res.status(400).json({
      message: t("{count} URL(s) are from unsupported sites", { count: unsupported.length }),
      unsupportedUrls: unsupported,
    });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    "Transfer-Encoding": "chunked",
  });

  const send = (event: ProgressEvent) => res.write(JSON.stringify(event) + "\n");
  const chapters: ExtractedChapter[] = [];
  const startedAt = Date.now();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const chapter = await extractWithRetry(url, (attempt) => {
      const attemptSuffix = attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : "";
      send({ type: "progress", index: i, total: urls.length, url, message: t("Loading & extracting…{attempt}", { attempt: attemptSuffix }) });
    });
    chapters.push(chapter);
    const etaMs = estimateRemainingMs({ startedAt, completed: i + 1, total: urls.length });
    if (chapter.error) {
      send({ type: "error", index: i, total: urls.length, url, message: chapter.error, etaMs });
    } else {
      send({ type: "chapter-done", index: i, cursor: i + 1, total: urls.length, url, etaMs });
    }
  }

  send({ type: "done", chapters });
  res.end();
});

// Non-streaming single-URL re-extract, used by the "Retry" button in the
// preview UI to recover one failed chapter without re-running the batch.
router.post("/extract-one", async (req, res) => {
  const { url } = req.body as { url: string };
  if (!url) {
    res.status(400).json({ message: t("url is required") });
    return;
  }
  if (!findSupportedSite(url)) {
    res.status(400).json({ message: t("This site is not yet supported: {url}", { url }) });
    return;
  }
  const chapter = await extractWithRetry(url);
  res.json({ chapter });
});

router.post("/cover-upload", upload.single("cover"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: t("Cover file is required") });
    return;
  }
  res.json({ path: req.file.path });
});

// Exporting EPUB with many images takes tens of seconds. A single response that both
// reports progress and returns binary data is not feasible, so we split it: POST streams
// NDJSON progress (like /api/extract) then returns an export ID, client GET that ID
// to fetch the file. File waits in RAM — single machine, single process, like runningCrawls.
const EXPORT_TTL_MS = 5 * 60_000;
// With many images the progress stream sends one line per image; batch them to avoid
// flooding the network with thousands of useless lines and thousands of re-renders.
const PROGRESS_INTERVAL_MS = 150;

const pendingExports = new Map<string, { buffer: Buffer; fileName: string }>();

function stashExport(buffer: Buffer, fileName: string): string {
  const exportId = randomUUID();
  pendingExports.set(exportId, { buffer, fileName });
  // unref: an expired export should not keep the process alive.
  setTimeout(() => pendingExports.delete(exportId), EXPORT_TTL_MS).unref();
  return exportId;
}

// Build book and stream progress to response. Errors go in the stream, not HTTP status:
// headers are already sent before we know if the build succeeds.
async function streamExport(
  res: ExpressResponse,
  metadata: BookMetadata,
  chapters: ExportChapter[],
  fileName: string
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });
  const send = (event: unknown) => res.write(`${JSON.stringify(event)}\n`);

  let lastSent = 0;
  let lastPhase = "";
  const onProgress = (progress: BuildProgress) => {
    const now = Date.now();
    // Always send when phase changes or when a phase completes: if we skip messages,
    // the UI will get stuck showing "Loading image 651/651…" during the final zip step.
    const keep = progress.phase !== lastPhase || progress.done === progress.total;
    if (!keep && now - lastSent < PROGRESS_INTERVAL_MS) return;
    lastSent = now;
    lastPhase = progress.phase;
    send({ type: "progress", ...progress });
  };

  try {
    const buffer = await buildEpub(
      { ...metadata, coverUrl: metadata.coverUrl ? coverPathForExport(metadata.coverUrl) : undefined },
      chapters,
      onProgress
    );
    send({ type: "done", exportId: stashExport(buffer, fileName), fileName });
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : "EPUB export error" });
  }
  res.end();
}

// Fetch the built file. Download once and remove: don't keep tens of MB in RAM longer
// than necessary.
router.get("/exports/:exportId", (req, res) => {
  const pending = pendingExports.get(req.params.exportId);
  if (!pending) {
    res.status(404).json({ message: t("Export has expired or already been downloaded — click Export EPUB again") });
    return;
  }
  pendingExports.delete(req.params.exportId);
  res.writeHead(200, {
    "Content-Type": "application/epub+zip",
    "Content-Disposition": contentDisposition(pending.fileName),
    "Content-Length": pending.buffer.length,
  });
  res.end(pending.buffer);
});

router.post("/export", async (req, res) => {
  const { metadata, chapters } = req.body as ExportRequest;
  if (!metadata || !Array.isArray(chapters)) {
    res.status(400).json({ message: t("metadata and chapters are required") });
    return;
  }
  await streamExport(res, metadata, chapters, epubFileName(metadata.title || "book"));
});

// Crawls in progress per story, with current position so a session opened mid-crawl
// knows exactly where it is (see /stories/:id/live). `startedAt` + `etaMs` are used
// to estimate remaining time.
const runningCrawls = new Map<
  string,
  { cursor: number; total: number; startedAt: number; etaMs?: number }
>();

// Sessions listening to live updates per story. Crawl continues after the request that
// started it ends, so a newly reloaded session (or another session) can still see it.
const liveSubscribers = new Map<string, Set<ExpressResponse>>();

// Shared channel: every session with the app open knows which stories are crawling, even
// those not yet selected (the library table shows a "Crawling" chip for all rows).
const liveAllSubscribers = new Set<ExpressResponse>();

function writeSse(res: ExpressResponse, payload: unknown) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}

function publish(storyId: string, event: ProgressEvent) {
  const subs = liveSubscribers.get(storyId);
  if (subs) {
    for (const res of subs) {
      if (!writeSse(res, event)) subs.delete(res);
    }
  }
  if (liveAllSubscribers.size === 0) return;
  const tagged = { ...event, storyId };
  for (const res of liveAllSubscribers) {
    if (!writeSse(res, tagged)) liveAllSubscribers.delete(res);
  }
}

// Load TOC and save story — used by both POST /stories (create/update from URL)
// and POST /stories/:id/refresh (the "Load N new chapters" button).
async function refreshStoryToc(params: {
  existing?: StoredStory;
  storyUrl: string;
  site: string;
  adapter: TocAdapter;
}): Promise<StoredStory> {
  const toc = await params.adapter.fetchToc(params.storyUrl);
  const story = mergeStory({ existing: params.existing, site: params.site, storyUrl: params.storyUrl, toc });
  // Download cover to data/covers/ once we know the story URL; if download fails, keep
  // the original URL so epub-gen can fetch it during export.
  const savedCover = await coverStore.save(story.id, story.coverUrl, params.storyUrl);
  if (savedCover) story.coverUrl = savedCover;
  await storyStore.save(story);
  return story;
}

router.post("/stories", async (req, res) => {
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
      message: t(
        "{site} does not yet support automatic chapter list loading — enter chapter URLs manually in the {tab} tab",
        { site: site.name, tab: t("Manual Crawl") }
      ),
    });
    return;
  }

  const storyUrl = adapter.normalizeStoryUrl(url);
  const id = storyId(storyUrl);
  if (runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling, cannot update chapter list") });
    return;
  }
  try {
    const existing = await storyStore.get(id);
    const story = await refreshStoryToc({ existing, storyUrl, site: site.domain, adapter });
    // User just manually loaded TOC: the "N new chapters" chip from the previous check
    // is now stale (new chapters became pending).
    await storyStore.setCheckResult(id, { newChapterCount: 0, checkedAt: new Date().toISOString(), error: null });
    res.json({ story });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : "Failed to load chapter list" });
  }
});

router.get("/stories", async (_req, res) => {
  res.json({ stories: await storyStore.list() });
});

// Shared live channel: snapshot of all running crawls on connect, then all events with
// `storyId` — enough for the library table to know which stories are crawling without
// needing to select one. Must come before /stories/:id so "live" isn't treated as an ID.
router.get("/stories/live", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 2000\n\n");
  res.write(
    `data: ${JSON.stringify({
      type: "snapshot",
      crawls: [...runningCrawls.entries()].map(([storyId, state]) => ({ storyId, ...state })),
    })}\n\n`
  );

  liveAllSubscribers.add(res);
  const beat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
  }, 20_000);

  req.on("close", () => {
    clearInterval(beat);
    liveAllSubscribers.delete(res);
  });
});

// Chapter list without content: a story with thousands of crawled chapters weighs tens
// of MB if sent with blocks, but the chapter table only needs title + status. Individual
// chapter content is fetched separately via /stories/:id/chapters/:order.
router.get("/stories/:id", async (req, res) => {
  const story = await storyStore.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  res.json({ story });
});

// Downloaded cover image for the preview; if no cover exists, return 404 so
// frontend shows an empty placeholder instead of a broken image.
router.get("/stories/:id/cover", (req, res) => {
  const cover = coverStore.find(req.params.id);
  if (!cover) {
    res.status(404).json({ message: t("No cover image for this story") });
    return;
  }
  res.type(cover.contentType);
  res.sendFile(cover.filePath);
});

// Save book metadata edited by user in the detail panel (multipart because a new
// cover image may be included). Does not touch chapters, so can save mid-crawl.
router.post("/stories/:id/meta", upload.single("cover"), async (req, res) => {
  const { id } = req.params;
  const story = await storyStore.get(id);
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
    const savedCover = await coverStore.saveUpload(id, req.file.path);
    if (!savedCover) {
      res.status(400).json({ message: t("Invalid cover file — only JPG, PNG, WebP, or GIF accepted") });
      return;
    }
    coverUrl = savedCover;
  }

  await storyStore.updateMeta(id, {
    title: title.trim(),
    author: author?.trim() || undefined,
    language: language?.trim() || undefined,
    coverUrl,
  });
  res.json({ story: await storyStore.getOutline(id) });
});

// One chapter's content, fetched when user opens it to view/edit.
router.get("/stories/:id/chapters/:order", async (req, res) => {
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: t("Invalid chapter order") });
    return;
  }
  const chapter = await storyStore.getChapter(req.params.id, order);
  if (!chapter) {
    res.status(404).json({ message: t("Chapter not found") });
    return;
  }
  res.json({ chapter });
});

// Export EPUB for saved story: content comes straight from DB, client only sends
// chapters it's editing — no need to download the entire story and push it back.
router.post("/stories/:id/export", async (req, res) => {
  const { id } = req.params;
  const { metadata, chapters } = req.body as {
    metadata?: BookMetadata;
    chapters?: { order: number; title?: string; contentHtml?: string }[];
  };
  if (!metadata || !Array.isArray(chapters)) {
    res.status(400).json({ message: t("metadata and chapters are required") });
    return;
  }

  const story = await storyStore.get(id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }

  try {
    const byOrder = new Map(story.chapters.map((c) => [c.order, c]));
    const included: ExportChapter[] = [];
    for (const wanted of chapters) {
      const stored = byOrder.get(wanted.order);
      // If client sends content for a chapter (still editing it), use that; otherwise
      // build from saved blocks.
      // Empty string (chapter opened but content failed to load) also falls back to DB
      // so we don't silently export blank chapters.
      const contentHtml = wanted.contentHtml || (stored ? blocksToHtml(stored.blocks ?? []) : "");
      if (!contentHtml) continue;
      included.push({ title: wanted.title ?? stored?.title ?? "", includeInBook: true, contentHtml });
    }

    await streamExport(res, metadata, included, epubFileName(metadata.title || story.title || "book"));
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : "EPUB export error" });
  }
});

// Edit chapter title and content. Crawled content often mixes junk from the source site
// (web frame, ads, repeated chapter name), so user cleans it in the editor and saves
// to override the fetched version.
router.patch("/stories/:id/chapters/:order", async (req, res) => {
  const { id } = req.params;
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: t("Invalid chapter order") });
    return;
  }
  // Active crawl will overwrite the chapter with newly extracted content, so block edits
  // to prevent user losing work after cleaning it up.
  if (runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling, cannot edit chapters") });
    return;
  }

  const chapter = await storyStore.getChapter(id, order);
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
  };
  await storyStore.saveChapter(id, updated);
  res.json({ chapter: updated });
});

// Highlights live server-side rather than in the browser: they are the reader's own
// notes on the text, and losing them to a cleared browser cache — or not seeing them
// in the Electron build after making them in the browser — would be worse than the
// extra routes.
router.get("/stories/:id/highlights", async (req, res) => {
  res.json({ highlights: await storyStore.listHighlights(req.params.id) });
});

router.post("/stories/:id/highlights", async (req, res) => {
  const { chapterOrder, start, end, color, text } = req.body ?? {};
  if (!Number.isInteger(chapterOrder) || chapterOrder < 1) {
    res.status(400).json({ message: t("Invalid chapter order") });
    return;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    res.status(400).json({ message: t("Invalid highlight range") });
    return;
  }
  if (!HIGHLIGHT_COLORS.includes(color)) {
    res.status(400).json({ message: t("Invalid highlight colour") });
    return;
  }
  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ message: t("Highlighted text is required") });
    return;
  }
  if (!(await storyStore.getOutline(req.params.id))) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const highlight = await storyStore.addHighlight(req.params.id, {
    chapterOrder,
    start,
    end,
    color: color as HighlightColor,
    text,
  });
  res.status(201).json({ highlight });
});

router.patch("/stories/:id/highlights/:highlightId", async (req, res) => {
  const color = req.body?.color;
  if (!HIGHLIGHT_COLORS.includes(color)) {
    res.status(400).json({ message: t("Invalid highlight colour") });
    return;
  }
  const updated = await storyStore.setHighlightColor(req.params.id, req.params.highlightId, color);
  if (!updated) {
    res.status(404).json({ message: t("Highlight not found") });
    return;
  }
  res.json({ ok: true });
});

router.delete("/stories/:id/highlights/:highlightId", async (req, res) => {
  const removed = await storyStore.removeHighlight(req.params.id, req.params.highlightId);
  if (!removed) {
    res.status(404).json({ message: t("Highlight not found") });
    return;
  }
  res.json({ ok: true });
});

router.delete("/stories/:id", async (req, res) => {
  if (runningCrawls.has(req.params.id)) {
    res.status(409).json({ message: t("Story is currently crawling, cannot delete") });
    return;
  }
  const removed = await storyStore.remove(req.params.id);
  if (!removed) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  await coverStore.remove(req.params.id);
  res.json({ ok: true });
});

// Live channel for one story: every crawl change is pushed to sessions viewing it — no
// reload, no polling needed. On connect, new sessions immediately get a snapshot
// (crawl position or idle state).
router.get("/stories/:id/live", (req, res) => {
  const { id } = req.params;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 2000\n\n");

  const current = runningCrawls.get(id);
  const snapshot: ProgressEvent = current
    ? { type: "running", cursor: current.cursor, total: current.total }
    : { type: "idle" };
  res.write(`data: ${JSON.stringify(snapshot)}\n\n`);

  const subs = liveSubscribers.get(id) ?? new Set<ExpressResponse>();
  subs.add(res);
  liveSubscribers.set(id, subs);

  // Keep connection alive through proxies and signal to client that server is still there.
  const beat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
  }, 20_000);

  req.on("close", () => {
    clearInterval(beat);
    subs.delete(res);
    if (subs.size === 0) liveSubscribers.delete(id);
  });
});

// Enable/disable watching for new chapters of a story.
router.post("/stories/:id/watch", async (req, res) => {
  const { id } = req.params;
  const { watching } = req.body as { watching?: unknown };
  if (typeof watching !== "boolean") {
    res.status(400).json({ message: t("watching must be true or false") });
    return;
  }
  const story = await storyStore.getOutline(id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  await storyStore.setWatching(id, watching);
  res.json({ story: await storyStore.getOutline(id) });
});

// Check current TOC to see if the story has new chapters. Only counts and saves result —
// doesn't add chapters to library; user clicks "Load N new chapters" to actually load
// them (via /stories/:id/refresh).
router.post("/stories/:id/check", async (req, res) => {
  const { id } = req.params;
  const story = await storyStore.getOutline(id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const adapter = getTocAdapter(story.storyUrl);
  if (!adapter) {
    res.status(400).json({ message: t("This story has no TOC adapter for checking") });
    return;
  }
  if (runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling") });
    return;
  }

  try {
    const toc = await adapter.fetchToc(story.storyUrl);
    const newChapterCount = countNewChapters(story.chapters, toc.chapters);
    const checkedAt = new Date().toISOString();
    await storyStore.setCheckResult(id, { newChapterCount, checkedAt, error: null });
    res.json({ newChapterCount, lastCheckedAt: checkedAt, checkError: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not check for new chapters";
    // Keep previous new chapter count and last successful check; just record this error
    // so the UI can show a warning.
    await storyStore.setCheckResult(id, { error: message });
    res.status(502).json({ message });
  }
});

// Reload TOC for existing story: old chapters keep their content/status, new ones become
// pending. Used by the "Load N new chapters" button in story detail.
router.post("/stories/:id/refresh", async (req, res) => {
  const { id } = req.params;
  const existing = await storyStore.get(id);
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
  if (runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling, cannot update chapter list") });
    return;
  }

  try {
    const story = await refreshStoryToc({
      existing,
      storyUrl: existing.storyUrl,
      site: site.domain,
      adapter,
    });
    await storyStore.setCheckResult(id, { newChapterCount: 0, checkedAt: new Date().toISOString(), error: null });
    res.json({ story });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : "Failed to load chapter list" });
  }
});

router.post("/stories/:id/crawl", async (req, res) => {
  const { id } = req.params;
  // Use getOutline not get: the loop below only needs url/order/status, while get()
  // parses content for every crawled chapter — a story with hundreds of chapters is
  // tens of MB sitting in RAM for the whole crawl unused.
  const story: StoredStory | undefined = await storyStore.getOutline(id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  if (runningCrawls.has(id)) {
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

  const send = (event: ProgressEvent) => publish(id, event);

  const startedAt = Date.now();
  runningCrawls.set(id, { cursor: 0, total: plan.length, startedAt });
  try {
    // Cover is downloaded only once (subsequent crawls skip because file exists): stories
    // created before this feature will get their cover on the next "Continue crawl".
    const savedCover = await coverStore.save(id, story.coverUrl, story.storyUrl);
    if (savedCover && savedCover !== story.coverUrl) {
      story.coverUrl = savedCover;
      // Re-read before saving: user may have just clicked "Save metadata" during crawl —
      // don't overwrite with the stale in-memory copy.
      const fresh = await storyStore.get(id);
      if (fresh) {
        await storyStore.updateMeta(id, {
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
      runningCrawls.set(id, {
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
        stored.blocks = extracted.error ? undefined : extracted.blocks;
        if (!extracted.error) stored.title = pickChapterTitle(stored.title, extracted.title, stored.url);
        await storyStore.saveChapter(story.id, stored);
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
    publish(id, { type: "error", message });
  } finally {
    runningCrawls.delete(id);
    publish(id, { type: "idle" });
  }
});

export default router;
