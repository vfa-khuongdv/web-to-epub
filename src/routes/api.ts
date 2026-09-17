import { Router } from "express";
import multer from "multer";
import os from "os";
import { renderPageHtml } from "../services/renderer";
import { extractChapter, LockedContentError } from "../services/extractor";
import { buildEpub } from "../services/epubBuilder";
import { findSupportedSite, SUPPORTED_SITES } from "../config/supportedSites";
import { ExportRequest, ExtractedChapter, ExtractRequest, ProgressEvent } from "../types";

const router = Router();
const upload = multer({ dest: os.tmpdir() });

router.get("/supported-sites", (_req, res) => {
  res.json({ sites: SUPPORTED_SITES });
});

// Returns hostnames (without protocol) that aren't in the supported-site
// allowlist, or null if every URL is supported.
function findUnsupportedUrls(urls: string[]): string[] | null {
  const unsupported = urls.filter((url) => !findSupportedSite(url));
  return unsupported.length > 0 ? unsupported : null;
}

// Some sites' anti-tool scripts blank the page at random (see renderer.ts),
// and a cold browser session can take ~10 loads before it settles down, so
// the budget is generous — each attempt is a fresh page load, and a warm
// session succeeds on the first or second try.
const MAX_ATTEMPTS = 12;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries render+extract a few times before giving up — some sites finish
// loading their chapter body slightly after network-idle, which makes
// extraction fail intermittently rather than consistently. On final failure
// this returns a chapter with `error` set instead of throwing, so the
// caller can still show/keep a slot for it (and offer a manual retry) rather
// than silently dropping it from the result set.
async function extractWithRetry(url: string, onAttempt?: (attempt: number) => void): Promise<ExtractedChapter> {
  let lastError = "Lỗi không xác định";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onAttempt?.(attempt);
    try {
      const html = await renderPageHtml(url);
      return extractChapter(url, html);
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError;
      // A locked chapter can't be unlocked by rendering again — fail fast
      // instead of burning the whole retry budget on it. (The preview UI
      // still offers a manual retry per chapter.)
      if (err instanceof LockedContentError) break;
      if (attempt < MAX_ATTEMPTS) await sleep(Math.min(1000 * attempt, 3000));
    }
  }
  return { sourceUrl: url, title: url, blocks: [], error: lastError };
}

// Streams NDJSON progress events (one JSON object per line) while crawling
// each chapter URL sequentially, so the frontend can show a progress bar
// without holding a long-lived request open per chapter.
router.post("/extract", async (req, res) => {
  const { urls } = req.body as ExtractRequest;
  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ message: "urls là bắt buộc và phải là mảng không rỗng" });
    return;
  }

  const unsupported = findUnsupportedUrls(urls);
  if (unsupported) {
    res.status(400).json({
      message: `${unsupported.length} URL không thuộc trang được hỗ trợ`,
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

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const chapter = await extractWithRetry(url, (attempt) => {
      const attemptSuffix = attempt > 1 ? ` (lần thử ${attempt}/${MAX_ATTEMPTS})` : "";
      send({ type: "progress", index: i, total: urls.length, url, message: `Đang tải & trích xuất...${attemptSuffix}` });
    });
    chapters.push(chapter);
    if (chapter.error) {
      send({ type: "error", index: i, total: urls.length, url, message: chapter.error });
    }
  }

  send({ type: "done", chapters });
  res.end();
});

// Non-streaming single-URL re-extract, used by the "Thử lại" button in the
// preview UI to recover one failed chapter without re-running the batch.
router.post("/extract-one", async (req, res) => {
  const { url } = req.body as { url: string };
  if (!url) {
    res.status(400).json({ message: "url là bắt buộc" });
    return;
  }
  if (!findSupportedSite(url)) {
    res.status(400).json({ message: `Trang này chưa được hỗ trợ: ${url}` });
    return;
  }
  const chapter = await extractWithRetry(url);
  res.json({ chapter });
});

router.post("/cover-upload", upload.single("cover"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: "Thiếu file cover" });
    return;
  }
  res.json({ path: req.file.path });
});

router.post("/export", async (req, res) => {
  const { metadata, chapters } = req.body as ExportRequest;
  if (!metadata || !Array.isArray(chapters)) {
    res.status(400).json({ message: "metadata và chapters là bắt buộc" });
    return;
  }
  try {
    const buffer = await buildEpub(metadata, chapters);
    res.writeHead(200, {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `attachment; filename="${(metadata.title || "book").replace(/[^a-z0-9]+/gi, "_")}.epub"`,
      "Content-Length": buffer.length,
    });
    res.end(buffer);
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : "Lỗi export EPUB" });
  }
});

export default router;
