import crypto from "crypto";
import fs from "fs";
import express from "express";
import { createRouter } from "./asyncRouter";
import multer from "multer";
import os from "os";
import path from "path";
import { findSupportedSite } from "../config/supportedSites";
import {
  ArchiveLoginRequiredError,
  ArchiveLoanError,
  ArchiveNotBookError,
  ArchiveNotFoundError,
  ArchiveRestrictedError,
  ArchiveTooManyPagesError,
  ArchiveUnavailableError,
  archiveItemId,
  importArchiveItem,
} from "../services/archiveImport";
import { DrmError, EpubTooLargeError, ImportedBook, NotEpubError, parseEpub } from "../services/epubImport";
import { CloudflareBlockedError } from "../services/cloudflare";
import { DtvEbookNoEpubError, DtvEbookNotFoundError, dtvEbookId, importDtvEbook } from "../services/dtvEbookImport";
import { HeyzineNotFoundError, HeyzineUnavailableError, heyzineId, importHeyzine } from "../services/heyzineImport";
import { isPdf, NotPdfError, parsePdf, PdfLockedError, PdfTooLargeError } from "../services/pdfImport";
import { MAX_COVER_BYTES, sniffImageExtension, UPLOADS_DIR } from "../services/coverStore";
import { settingsStore } from "../services/settingsStore";
import { loadSiteSession, SiteSessionUnreadableError } from "../services/siteSession";
import { storyId } from "../services/storyStore";
import { storyUsage } from "../services/storyUsage";
import { countNewChapters, mergeStory } from "../services/storyService";
import { getTocAdapter } from "../sites";
import { activeAgent } from "../services/agent/agentConfig";
import { AgentDocumentPageError, articleViaAgent, createAgentTocAdapter, hasAgentCrawler, hasArticleCrawler, webStoryUrl } from "../services/agent/agentCrawler";
import { TocAdapter } from "../services/toc/types";
import { t } from "../services/lang";
import { removeStoryAudio } from "../services/tts/audioCache";
import { StoredStory } from "../types";
import { Library, libraryFor } from "./library";

export const storiesRouter = createRouter();

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: MAX_COVER_BYTES } });

// An upload rejected by multer (over the cap) or by the route's own early checks must not
// leave the temp file behind; the size cap is the same one the cover store accepts.
async function discardUpload(file: Express.Multer.File | undefined): Promise<void> {
  if (file) await fs.promises.rm(file.path, { force: true }).catch(() => {});
}

const uploadCover: express.RequestHandler = (req, res, next) => {
  upload.single("cover")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    void discardUpload(req.file);
    const tooLarge = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
    res.status(400).json({
      message: tooLarge
        ? t("The cover file is too large (maximum {size} MB)", { size: Math.round(MAX_COVER_BYTES / (1024 * 1024)) })
        : t("Invalid cover file — only JPG, PNG, WebP, or GIF accepted"),
    });
  });
};

// A book bigger than this is refused before parsing: the raw body parser's own limit
// sits just above so an oversized file still gets our JSON message.
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const IMPORT_BODY_LIMIT = MAX_IMPORT_BYTES + 1024 * 1024;

// A chapter list reload that lands while a crawl is running would replace chapters from
// the snapshot taken before the TOC fetch, wiping what the crawl has been saving.
class StoryCrawlingError extends Error {}

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
  // the original URL and the export downloads it later through the public-address check.
  const savedCover = await library.covers.save(story.id, story.coverUrl, params.storyUrl);
  if (savedCover) story.coverUrl = savedCover;
  // The route checked before fetching, but a crawl can start while the TOC and the cover
  // are loading: saving now would overwrite that crawl's chapters with this stale list.
  if (library.runningCrawls.has(story.id)) {
    throw new StoryCrawlingError(t("Story is currently crawling, cannot update chapter list"));
  }
  await library.stories.save(story);
  return (await library.stories.getOutline(story.id)) as StoredStory;
}

// The adapter and site label for a story URL: a supported site's own, else — only when AI
// crawling is on AND the request asked for it (`ai: true`, the home page's agent button) — the
// agent adapter, labelled by hostname. Stories already added that way keep using it for
// check/refresh, which pass allowAi themselves.
function resolveToc(url: string, allowAi: boolean): { site: string; adapter: TocAdapter } | { error: "unsupported" | "no-adapter"; name?: string } {
  const supported = findSupportedSite(url);
  if (supported) {
    const adapter = getTocAdapter(url);
    return adapter ? { site: supported.domain, adapter } : { error: "no-adapter", name: supported.name };
  }
  if (!allowAi || !activeAgent()) return { error: "unsupported" };
  try {
    return { site: new URL(url).hostname.replace(/^www\./, ""), adapter: createAgentTocAdapter() };
  } catch {
    return { error: "unsupported" };
  }
}

storiesRouter.post("/stories", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ message: t("url is required") });
    return;
  }
  if (archiveItemId(url)) {
    res.status(400).json({ message: t("Internet Archive books are imported, not crawled") });
    return;
  }
  if (dtvEbookId(url)) {
    res.status(400).json({ message: t("DTV Ebook books are imported, not crawled") });
    return;
  }
  if (heyzineId(url)) {
    res.status(400).json({ message: t("Heyzine flipbooks are imported, not crawled") });
    return;
  }
  const resolved = resolveToc(url, (req.body as { ai?: unknown }).ai === true);
  if ("error" in resolved) {
    res.status(400).json({
      message:
        resolved.error === "no-adapter"
          ? t("{site} does not yet support automatic chapter list loading", { site: resolved.name as string })
          : t("This site is not yet supported: {url}", { url }),
    });
    return;
  }
  const { site, adapter } = resolved;
  const viaAgent = !findSupportedSite(url);

  const storyUrl = adapter.normalizeStoryUrl(url);
  const id = storyId(storyUrl);
  if (library.runningCrawls.has(id)) {
    res.status(409).json({ message: t("Story is currently crawling, cannot update chapter list") });
    return;
  }
  try {
    // A site the agent already wrote a page reader for: skip asking again what kind of page this is.
    if (viaAgent && (await hasArticleCrawler(url))) {
      res.json({ story: await importWebPage(library, url) });
      return;
    }
    const existing = await library.stories.get(id);
    const story = await refreshStoryToc({ library, existing, storyUrl, site, adapter });
    // User just manually loaded TOC: the "N new chapters" chip from the previous check
    // is now stale (new chapters became pending).
    await library.stories.setCheckResult(id, { newChapterCount: 0, checkedAt: new Date().toISOString(), error: null });
    res.json({ story });
  } catch (err) {
    if (viaAgent && err instanceof AgentDocumentPageError) {
      try {
        res.json({ story: await importWebPage(library, url) });
      } catch (inner) {
        res.status(502).json({ message: inner instanceof Error ? inner.message : t("Could not read this page") });
      }
      return;
    }
    if (err instanceof StoryCrawlingError) {
      res.status(409).json({ message: err.message });
      return;
    }
    res.status(502).json({ message: err instanceof Error ? err.message : "Failed to load chapter list" });
  }
});

// A page that is one whole text (article, paper, book on a single page): the agent's page reader turns it
// into chapters and it is saved like an imported book (site "epub", nothing to crawl or watch). The story
// URL is `web:<address>`, so adding the same page again returns the story already in the library.
async function importWebPage(library: Library, url: string): Promise<StoredStory> {
  const storyUrl = webStoryUrl(url);
  const id = storyId(storyUrl);
  const existing = await library.stories.getOutline(id);
  if (existing) return existing;
  const agent = activeAgent();
  if (!agent) throw new Error(t("The agent crawler is off or its agent is not installed (Settings → Agent crawler)"));
  const { coverUrl, ...book } = await articleViaAgent(agent, url);
  return saveImportedBook(library, { id, storyUrl, book, coverUrl });
}

// Save a book that came from a source with no chapter list (a file, archive.org, a site
// that only hosts the EPUB) as an imported story: site "epub" so the crawl/watch controls
// stay hidden, every chapter already done. The book's own metadata wins; a re-import
// keeps what the reader edited, and a new story starts from the settings defaults.
async function saveImportedBook(
  library: Library,
  params: { id: string; storyUrl: string; book: ImportedBook; existing?: StoredStory; coverUrl?: string }
): Promise<StoredStory> {
  const { id, storyUrl, book, existing } = params;
  let coverUrl = existing?.coverUrl;
  if (book.cover) {
    const saved = library.covers.saveBytes(id, book.cover.bytes);
    if (saved) coverUrl = saved;
  } else if (params.coverUrl) {
    // A page's cover is an address, not bytes: download it, or keep the address for the export to fetch.
    coverUrl = (await library.covers.save(id, params.coverUrl, storyUrl.replace(/^web:/, ""))) ?? params.coverUrl;
  }
  const defaults = settingsStore.get();
  const now = new Date().toISOString();
  const story: StoredStory = {
    id,
    storyUrl,
    site: "epub",
    title: book.title,
    author: book.author ?? existing?.author ?? (defaults.defaultAuthor || undefined),
    language: book.language ?? existing?.language ?? defaults.defaultBookLanguage,
    coverUrl,
    watching: false,
    newChapterCount: 0,
    chapters: book.chapters.map((chapter, index) => ({
      order: index + 1,
      url: `${storyUrl}#${index + 1}`,
      title: chapter.title,
      status: "done" as const,
      blocks: chapter.blocks,
    })),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await library.stories.save(story);
  // getOutline only drops the chapter bodies, so it is the same story the routes answer with.
  return (await library.stories.getOutline(id)) as StoredStory;
}

// Import an .epub file as a story. A file hash gives the story a stable URL and id, so
// re-importing the same file targets the same story; without ?overwrite=1 that answers
// 409 and the UI asks first. Parsing and the cover/media writes happen here, in the
// library the request is talking to (private mode included).
storiesRouter.post(
  "/stories/import-epub",
  express.raw({ type: () => true, limit: IMPORT_BODY_LIMIT }),
  async (req, res) => {
    const library = libraryFor(req, res);
    if (!library) return;
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0) {
      res.status(400).json({ message: t("Please choose an EPUB or PDF file") });
      return;
    }
    if (bytes.length > MAX_IMPORT_BYTES) {
      res.status(400).json({ message: t("The file is too large (maximum {size} MB)", { size: 100 }) });
      return;
    }

    // A PDF is converted into chapters here and then lives on as an imported book like an
    // EPUB (site "epub": no TOC, nothing to crawl); only its story URL tells them apart.
    const pdf = isPdf(bytes);
    const hash = crypto.createHash("sha1").update(bytes).digest("hex");
    const storyUrl = `${pdf ? "pdf" : "epub"}:${hash}`;
    const id = storyId(storyUrl);
    const overwrite = req.query.overwrite === "1";
    const existing = await library.stories.getOutline(id);
    if (existing && !overwrite) {
      res.status(409).json({ code: "exists", message: t("This book is already in the library"), story: existing });
      return;
    }
    const name = typeof req.query.name === "string" ? path.basename(req.query.name) : "";
    const fallbackTitle = name ? path.parse(name).name : undefined;

    try {
      const parseOptions = {
        fallbackTitle,
        storeImage: (imageBytes: Buffer, extension: string) => library.epubMedia.save(id, imageBytes, extension),
      };
      const book = pdf ? await parsePdf(bytes, parseOptions) : await parseEpub(bytes, parseOptions);
      const story = await saveImportedBook(library, { id, storyUrl, book, existing });
      res.status(existing ? 200 : 201).json({ story });
    } catch (err) {
      // Only the parser's own, already-translated errors are safe to echo; anything else
      // (raw parser messages, FS/SQLite failures with absolute paths) gets the generic
      // wording instead of leaking internals.
      const message =
        err instanceof NotEpubError ||
        err instanceof EpubTooLargeError ||
        err instanceof DrmError ||
        err instanceof NotPdfError ||
        err instanceof PdfTooLargeError ||
        err instanceof PdfLockedError
          ? err.message
          : t(pdf ? "Could not import the PDF file" : "Could not import the EPUB file");
      res.status(400).json({ message });
    }
  }
);

// Import an Internet Archive book. The item id is the story URL, so re-adding the same
// item asks before overwriting, exactly like a file import. Only openly downloadable
// items are ever read — lending/restricted items are refused in services/archiveImport.ts.
storiesRouter.post("/stories/import-archive", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { url } = (req.body ?? {}) as { url?: string };
  if (!url) {
    res.status(400).json({ message: t("url is required") });
    return;
  }
  const itemId = archiveItemId(url);
  if (!itemId) {
    res.status(400).json({
      message: t(
        "This is not an Internet Archive book page: {url} — paste a URL like https://archive.org/details/<id>",
        { url }
      ),
    });
    return;
  }
  const storyUrl = `archive:${itemId}`;
  const id = storyId(storyUrl);
  const overwrite = req.query.overwrite === "1";
  const existing = await library.stories.getOutline(id);
  if (existing && !overwrite) {
    res.status(409).json({ code: "exists", message: t("This book is already in the library"), story: existing });
    return;
  }

  try {
    const book = await importArchiveItem(itemId, {
      storeImage: (imageBytes, extension) => library.epubMedia.save(id, imageBytes, extension),
      session: loadSiteSession(`https://archive.org/details/${itemId}`),
    });
    const story = await saveImportedBook(library, { id, storyUrl, book, existing });
    res.status(existing ? 200 : 201).json({ story });
  } catch (err) {
    // Only the service's own, already-translated errors are safe to echo; anything else
    // (network failure, parser internals) gets the generic wording.
    const message =
      err instanceof ArchiveNotFoundError ||
      err instanceof ArchiveNotBookError ||
      err instanceof ArchiveRestrictedError ||
      err instanceof ArchiveTooManyPagesError ||
      err instanceof ArchiveUnavailableError ||
      err instanceof ArchiveLoginRequiredError ||
      err instanceof ArchiveLoanError ||
      err instanceof SiteSessionUnreadableError
        ? err.message
        : t("Could not import from Internet Archive");
    res.status(400).json({ message });
  }
});

// Import a book from dtv-ebook.com.vn. The site has no chapter pages — each book is one
// EPUB the site hosts, named by its "Đọc online" reader page — so this reads that file
// (services/dtvEbookImport.ts) instead of crawling. The book id is the story URL, so
// re-adding the same book asks before overwriting, like the other imports.
storiesRouter.post("/stories/import-dtvebook", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { url } = (req.body ?? {}) as { url?: string };
  if (!url) {
    res.status(400).json({ message: t("url is required") });
    return;
  }
  const bookId = dtvEbookId(url);
  if (!bookId) {
    res.status(400).json({
      message: t("This is not a DTV Ebook book page: {url} — paste a URL like https://dtv-ebook.com.vn/<name>_<id>.html", {
        url,
      }),
    });
    return;
  }
  const storyUrl = `dtv:${bookId}`;
  const id = storyId(storyUrl);
  const overwrite = req.query.overwrite === "1";
  const existing = await library.stories.getOutline(id);
  if (existing && !overwrite) {
    res.status(409).json({ code: "exists", message: t("This book is already in the library"), story: existing });
    return;
  }

  try {
    const book = await importDtvEbook(bookId, {
      storeImage: (imageBytes, extension) => library.epubMedia.save(id, imageBytes, extension),
    });
    const story = await saveImportedBook(library, { id, storyUrl, book, existing });
    res.status(existing ? 200 : 201).json({ story });
  } catch (err) {
    const message =
      err instanceof DtvEbookNotFoundError || err instanceof DtvEbookNoEpubError || err instanceof CloudflareBlockedError
        ? err.message
        : t("Could not import from DTV Ebook");
    res.status(400).json({ message });
  }
});

// Import a book from a heyzine.com flipbook. The flipbook renders a PDF the site hosts,
// so services/heyzineImport.ts reads that file instead of crawling page images. A
// password-protected flipbook exposes no PDF and is refused. The flipbook id is the story
// URL, so re-adding the same book asks before overwriting, like the other imports.
storiesRouter.post("/stories/import-heyzine", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { url } = (req.body ?? {}) as { url?: string };
  if (!url) {
    res.status(400).json({ message: t("url is required") });
    return;
  }
  const bookId = heyzineId(url);
  if (!bookId) {
    res.status(400).json({
      message: t("This is not a Heyzine flipbook: {url} — paste a URL like https://heyzine.com/flip-book/<id>.html", {
        url,
      }),
    });
    return;
  }
  const storyUrl = `heyzine:${bookId}`;
  const id = storyId(storyUrl);
  const overwrite = req.query.overwrite === "1";
  const existing = await library.stories.getOutline(id);
  if (existing && !overwrite) {
    res.status(409).json({ code: "exists", message: t("This book is already in the library"), story: existing });
    return;
  }

  try {
    const book = await importHeyzine(bookId, {
      storeImage: (imageBytes, extension) => library.epubMedia.save(id, imageBytes, extension),
    });
    const story = await saveImportedBook(library, { id, storyUrl, book, existing });
    res.status(existing ? 200 : 201).json({ story });
  } catch (err) {
    // Only already-translated errors are echoed; anything else gets the generic wording.
    const message =
      err instanceof CloudflareBlockedError ||
      err instanceof HeyzineNotFoundError ||
      err instanceof HeyzineUnavailableError ||
      err instanceof NotPdfError ||
      err instanceof PdfLockedError ||
      err instanceof PdfTooLargeError
        ? err.message
        : t("Could not import from Heyzine");
    res.status(400).json({ message });
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

// What the story takes on disk, for the story page: text, pictures, audio, cover.
storiesRouter.get("/stories/:id/size", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  if (!(await library.stories.getOutline(req.params.id))) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  res.json({ size: await storyUsage(library, req.params.id) });
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

// Book image stored by an import, served to the reader/editor. `libraryFor` makes the
// private library's ?vault= work, like the cover route.
storiesRouter.get("/stories/:id/media/:name", (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const media = library.epubMedia.find(req.params.id, req.params.name);
  if (!media) {
    res.status(404).json({ message: t("Book image not found") });
    return;
  }
  res.type(media.contentType);
  res.sendFile(media.filePath);
});

// Save book metadata edited by user in the detail panel (multipart because a new
// cover image may be included). Does not touch chapters, so can save mid-crawl.
storiesRouter.post("/stories/:id/meta", uploadCover, async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) {
    await discardUpload(req.file);
    return;
  }
  const { id } = req.params;
  const story = await library.stories.get(id);
  if (!story) {
    await discardUpload(req.file);
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const { title, author, language } = req.body as { title?: string; author?: string; language?: string };
  if (!title?.trim()) {
    await discardUpload(req.file);
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

// The picked image is checked and copied under covers/uploads, and the response names that
// relative path: export only accepts covers from there, so a client cannot point it at any
// other file on the machine.
storiesRouter.post("/cover-upload", uploadCover, async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) {
    if (req.file) await fs.promises.rm(req.file.path, { force: true });
    return;
  }
  if (!req.file) {
    res.status(400).json({ message: t("Cover file is required") });
    return;
  }
  const bytes = await fs.promises.readFile(req.file.path);
  await fs.promises.rm(req.file.path, { force: true });
  const extension = sniffImageExtension(bytes);
  if (!extension || bytes.length > MAX_COVER_BYTES) {
    res.status(400).json({ message: t("Cover file is required") });
    return;
  }
  const relative = path.join("covers", UPLOADS_DIR, `${crypto.randomUUID()}.${extension}`);
  await fs.promises.mkdir(path.join(library.dataDir, "covers", UPLOADS_DIR), { recursive: true });
  await fs.promises.writeFile(path.join(library.dataDir, relative), bytes);
  res.json({ path: relative });
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
  if (story.site === "epub") {
    res.status(400).json({ message: t("Imported books have no chapter list to watch") });
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
  const resolved = resolveToc(story.storyUrl, true);
  let adapter = "adapter" in resolved ? resolved.adapter : undefined;
  // Agent crawler turned off: a story it already wrote a crawler for can still be checked with that saved code.
  if (!adapter && !findSupportedSite(story.storyUrl) && (await hasAgentCrawler(story.storyUrl))) {
    adapter = createAgentTocAdapter();
  }
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
  const resolved = resolveToc(existing.storyUrl, true);
  if (!("adapter" in resolved)) {
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
      site: resolved.site,
      adapter: resolved.adapter,
    });
    await library.stories.setCheckResult(id, { newChapterCount: 0, checkedAt: new Date().toISOString(), error: null });
    res.json({ story });
  } catch (err) {
    if (err instanceof StoryCrawlingError) {
      res.status(409).json({ message: err.message });
      return;
    }
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
  if (library.runningNarrations.has(req.params.id)) {
    res.status(409).json({ message: t("Story is being narrated, cannot delete") });
    return;
  }
  const removed = await library.stories.remove(req.params.id);
  if (!removed) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  await library.covers.remove(req.params.id);
  await library.epubMedia.remove(req.params.id);
  await removeStoryAudio(library.dataDir, req.params.id);
  res.json({ ok: true });
});
