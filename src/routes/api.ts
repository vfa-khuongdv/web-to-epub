import { Router } from "express";
import multer from "multer";
import os from "os";
import { MAX_ATTEMPTS, extractWithRetry } from "../services/crawl";
import { buildEpub } from "../services/epubBuilder";
import { findSupportedSite, SUPPORTED_SITES } from "../config/supportedSites";
import { storyId, storyStore } from "../services/storyStore";
import { chaptersToCrawl, mergeStory, toExtractedChapter } from "../services/storyService";
import { getTocAdapter } from "../services/toc";
import { ExportRequest, ExtractedChapter, ExtractRequest, ProgressEvent, StoredStory } from "../types";

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

const crawlingStoryIds = new Set<string>();

router.post("/stories", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ message: "url là bắt buộc" });
    return;
  }
  const site = findSupportedSite(url);
  if (!site) {
    res.status(400).json({ message: `Trang này chưa được hỗ trợ: ${url}` });
    return;
  }
  const adapter = getTocAdapter(url);
  if (!adapter) {
    res.status(400).json({
      message: `${site.name} chưa hỗ trợ tự động load danh sách chương — hãy nhập URL từng chương ở tab "Crawl thủ công"`,
    });
    return;
  }

  const storyUrl = adapter.normalizeStoryUrl(url);
  const id = storyId(storyUrl);
  if (crawlingStoryIds.has(id)) {
    res.status(409).json({ message: "Truyện đang được crawl, không thể cập nhật danh sách chương" });
    return;
  }
  const existing = await storyStore.get(id);
  try {
    const toc = await adapter.fetchToc(storyUrl);
    const story = mergeStory({ existing, site: site.domain, storyUrl, toc });
    await storyStore.save(story);
    res.json({ story });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : "Không tải được danh sách chương" });
  }
});

router.get("/stories", async (_req, res) => {
  res.json({ stories: await storyStore.list() });
});

router.get("/stories/:id", async (req, res) => {
  const story = await storyStore.get(req.params.id);
  if (!story) {
    res.status(404).json({ message: "Không tìm thấy truyện" });
    return;
  }
  res.json({ story });
});

router.delete("/stories/:id", async (req, res) => {
  if (crawlingStoryIds.has(req.params.id)) {
    res.status(409).json({ message: "Truyện đang được crawl, không thể xoá" });
    return;
  }
  const removed = await storyStore.remove(req.params.id);
  if (!removed) {
    res.status(404).json({ message: "Không tìm thấy truyện" });
    return;
  }
  res.json({ ok: true });
});

router.post("/stories/:id/crawl", async (req, res) => {
  const { id } = req.params;
  const story: StoredStory | undefined = await storyStore.get(id);
  if (!story) {
    res.status(404).json({ message: "Không tìm thấy truyện" });
    return;
  }
  if (crawlingStoryIds.has(id)) {
    res.status(409).json({ message: "Truyện đang được crawl" });
    return;
  }

  const orders = Array.isArray((req.body as { orders?: number[] })?.orders)
    ? (req.body as { orders: number[] }).orders
    : undefined;
  const plan = chaptersToCrawl(story, orders);

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    "Transfer-Encoding": "chunked",
  });
  // Nếu client ngắt kết nối, ghi vào socket đã huỷ không ném lỗi (chỉ rơi vào
  // hư không) — bỏ qua và tiếp tục crawl, vì mỗi chương vẫn được lưu vào store
  // ngay khi xong.
  const send = (event: ProgressEvent) => {
    if (res.destroyed) return;
    res.write(JSON.stringify(event) + "\n");
  };

  crawlingStoryIds.add(id);
  try {
    for (let i = 0; i < plan.length; i++) {
      const chapter = plan[i];
      const extracted = await extractWithRetry(chapter.url, (attempt) => {
        const attemptSuffix = attempt > 1 ? ` (lần thử ${attempt}/${MAX_ATTEMPTS})` : "";
        send({ type: "progress", index: i, total: plan.length, url: chapter.url, message: `Đang tải & trích xuất...${attemptSuffix}` });
      });

      const stored = story.chapters.find((c) => c.order === chapter.order);
      if (stored) {
        stored.status = extracted.error ? "error" : "done";
        stored.error = extracted.error;
        stored.blocks = extracted.error ? undefined : extracted.blocks;
        if (!extracted.error) stored.title = extracted.title;
      }
      story.updatedAt = new Date().toISOString();
      await storyStore.save(story);

      if (extracted.error) {
        send({ type: "error", index: i, total: plan.length, url: chapter.url, message: extracted.error });
      }
    }
    send({ type: "done", chapters: story.chapters.map(toExtractedChapter) });
  } catch (err) {
    // Express 4 không bắt các promise rejection trong async handler — tự xử lý
    // để một lỗi giữa chừng (vd. save thất bại) không giết process.
    const message = err instanceof Error ? err.message : "Lỗi không xác định khi crawl";
    if (res.headersSent) {
      send({ type: "error", message });
    } else {
      res.status(500).json({ message });
    }
  } finally {
    crawlingStoryIds.delete(id);
    if (res.headersSent) res.end();
  }
});

export default router;
