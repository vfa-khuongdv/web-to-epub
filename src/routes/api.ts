import { Response as ExpressResponse, Router } from "express";
import multer from "multer";
import os from "os";
import path from "path";
import { MAX_ATTEMPTS, extractWithRetry } from "../services/crawl";
import { createCoverStore, coverPathForExport } from "../services/coverStore";
import { buildEpub, contentDisposition, epubFileName } from "../services/epubBuilder";
import { findSupportedSite, SUPPORTED_SITES } from "../config/supportedSites";
import { storyId, storyStore } from "../services/storyStore";
import { chaptersToCrawl, mergeStory } from "../services/storyService";
import { getTocAdapter } from "../services/toc";
import { ExportRequest, ExtractedChapter, ExtractRequest, ProgressEvent, StoredStory } from "../types";

const router = Router();
const upload = multer({ dest: os.tmpdir() });
const coverStore = createCoverStore(path.resolve("data"));

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
    const buffer = await buildEpub(
      { ...metadata, coverUrl: metadata.coverUrl ? coverPathForExport(metadata.coverUrl) : undefined },
      chapters
    );
    res.writeHead(200, {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": contentDisposition(epubFileName(metadata.title || "book")),
      "Content-Length": buffer.length,
    });
    res.end(buffer);
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : "Lỗi export EPUB" });
  }
});

// Crawl đang chạy theo từng truyện, kèm vị trí hiện tại để phiên mở giữa chừng
// biết ngay đang ở đâu (xem /stories/:id/live).
const runningCrawls = new Map<string, { cursor: number; total: number }>();

// Các phiên đang nghe realtime theo truyện. Crawl vẫn tiếp tục sau khi request
// bắt đầu nó kết thúc, nên phiên vừa reload (hoặc phiên khác) cũng xem được.
const liveSubscribers = new Map<string, Set<ExpressResponse>>();

// Kênh chung: mọi phiên đang mở app đều biết truyện nào đang crawl, kể cả
// truyện chưa được chọn (bảng thư viện hiện chip "Đang crawl" cho mọi dòng).
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
  if (runningCrawls.has(id)) {
    res.status(409).json({ message: "Truyện đang được crawl, không thể cập nhật danh sách chương" });
    return;
  }
  const existing = await storyStore.get(id);
  try {
    const toc = await adapter.fetchToc(storyUrl);
    const story = mergeStory({ existing, site: site.domain, storyUrl, toc });
    // Tải bìa về data/covers/ ngay khi biết URL truyện; không tải được thì giữ
    // URL gốc để epub-gen tự lấy lúc export.
    const savedCover = await coverStore.save(story.id, story.coverUrl, storyUrl);
    if (savedCover) story.coverUrl = savedCover;
    await storyStore.save(story);
    res.json({ story });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : "Không tải được danh sách chương" });
  }
});

router.get("/stories", async (_req, res) => {
  res.json({ stories: await storyStore.list() });
});

// Kênh realtime chung: ảnh chụp mọi crawl đang chạy lúc kết nối, sau đó là mọi
// sự kiện kèm `storyId` — đủ để bảng thư viện biết truyện nào đang crawl mà
// không cần chọn truyện. Đặt trước /stories/:id để "live" không bị hiểu là id.
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

router.get("/stories/:id", async (req, res) => {
  const story = await storyStore.get(req.params.id);
  if (!story) {
    res.status(404).json({ message: "Không tìm thấy truyện" });
    return;
  }
  res.json({ story });
});

// Ảnh bìa đã tải về cho giao diện xem trước; truyện chưa có bìa trả 404 để
// frontend hiện khung trống thay vì ảnh vỡ.
router.get("/stories/:id/cover", (req, res) => {
  const cover = coverStore.find(req.params.id);
  if (!cover) {
    res.status(404).json({ message: "Truyện chưa có ảnh bìa" });
    return;
  }
  res.type(cover.contentType);
  res.sendFile(cover.filePath);
});

// Lưu thông tin sách người dùng sửa trong khung chi tiết (multipart vì có thể
// kèm ảnh bìa mới). Không đụng tới chapter nên lưu được giữa chừng lúc crawl.
router.post("/stories/:id/meta", upload.single("cover"), async (req, res) => {
  const { id } = req.params;
  const story = await storyStore.get(id);
  if (!story) {
    res.status(404).json({ message: "Không tìm thấy truyện" });
    return;
  }
  const { title, author, language } = req.body as { title?: string; author?: string; language?: string };
  if (!title?.trim()) {
    res.status(400).json({ message: "Tên sách là bắt buộc" });
    return;
  }

  let coverUrl = story.coverUrl;
  if (req.file) {
    const savedCover = await coverStore.saveUpload(id, req.file.path);
    if (!savedCover) {
      res.status(400).json({ message: "File bìa không hợp lệ — chỉ nhận JPG, PNG, WebP hoặc GIF" });
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
  res.json({ story: await storyStore.get(id) });
});

router.delete("/stories/:id", async (req, res) => {
  if (runningCrawls.has(req.params.id)) {
    res.status(409).json({ message: "Truyện đang được crawl, không thể xoá" });
    return;
  }
  const removed = await storyStore.remove(req.params.id);
  if (!removed) {
    res.status(404).json({ message: "Không tìm thấy truyện" });
    return;
  }
  await coverStore.remove(req.params.id);
  res.json({ ok: true });
});

// Kênh realtime cho một truyện: mọi thay đổi của crawl đang chạy được đẩy cho
// các phiên đang mở truyện đó — không cần reload, không cần polling. Khi kết
// nối, phiên mới nhận ngay ảnh chụp trạng thái (đang crawl tới đâu, hay rảnh).
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

  // Giữ kết nối sống qua proxy và báo cho client biết server còn đó.
  const beat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
  }, 20_000);

  req.on("close", () => {
    clearInterval(beat);
    subs.delete(res);
    if (subs.size === 0) liveSubscribers.delete(id);
  });
});

router.post("/stories/:id/crawl", async (req, res) => {
  const { id } = req.params;
  const story: StoredStory | undefined = await storyStore.get(id);
  if (!story) {
    res.status(404).json({ message: "Không tìm thấy truyện" });
    return;
  }
  if (runningCrawls.has(id)) {
    res.status(409).json({ message: "Truyện đang được crawl" });
    return;
  }

  const orders = Array.isArray((req.body as { orders?: number[] })?.orders)
    ? (req.body as { orders: number[] }).orders
    : undefined;
  const plan = chaptersToCrawl(story, orders);

  // Trả lời ngay rồi crawl ở hậu trường: tiến trình đẩy qua kênh realtime nên
  // phiên vừa bấm (và mọi phiên khác đang mở truyện) thấy giống hệt nhau, kể cả
  // sau khi reload.
  res.status(202).json({ started: true, total: plan.length });

  const send = (event: ProgressEvent) => publish(id, event);

  runningCrawls.set(id, { cursor: 0, total: plan.length });
  try {
    // Bìa chỉ được tải về một lần (lần crawl sau bỏ qua vì file đã có): truyện
    // tạo trước khi có tính năng này sẽ tự có bìa ở lần "Crawl tiếp" kế tiếp.
    const savedCover = await coverStore.save(id, story.coverUrl, story.storyUrl);
    if (savedCover && savedCover !== story.coverUrl) {
      story.coverUrl = savedCover;
      // Đọc lại trước khi ghi: người dùng có thể vừa bấm "Lưu thông tin" trong
      // lúc crawl chạy — không được ghi đè bằng bản cũ trong bộ nhớ.
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
      runningCrawls.set(id, { cursor: i + 1, total: plan.length });
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
        await storyStore.saveChapter(story.id, stored);
      }

      if (extracted.error) {
        send({ type: "error", index: i, total: plan.length, url: chapter.url, message: extracted.error });
      }
    }
    send({ type: "done", total: plan.length });
  } catch (err) {
    // Express 4 không bắt các promise rejection trong async handler — tự xử lý
    // để một lỗi giữa chừng (vd. save thất bại) không giết process.
    const message = err instanceof Error ? err.message : "Lỗi không xác định khi crawl";
    publish(id, { type: "error", message });
  } finally {
    runningCrawls.delete(id);
    publish(id, { type: "idle" });
  }
});

export default router;
