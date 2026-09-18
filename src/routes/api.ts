import { randomUUID } from "crypto";
import { Response as ExpressResponse, Router } from "express";
import multer from "multer";
import os from "os";
import path from "path";
import { MAX_ATTEMPTS, extractWithRetry } from "../services/crawl";
import { createCoverStore, coverPathForExport } from "../services/coverStore";
import { BuildProgress, buildEpub, contentDisposition, epubFileName } from "../services/epubBuilder";
import { findSupportedSite, SUPPORTED_SITES } from "../config/supportedSites";
import { DATA_DIR } from "../config/paths";
import { storyId, storyStore } from "../services/storyStore";
import { blocksToHtml, htmlToBlocks } from "../services/chapterHtml";
import { chaptersToCrawl, mergeStory, pickChapterTitle } from "../services/storyService";
import { getTocAdapter } from "../services/toc";
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

// Xuất EPUB truyện nhiều ảnh mất hàng chục giây. Một response vừa báo tiến
// trình vừa trả file nhị phân thì không làm được, nên tách đôi: POST stream
// NDJSON tiến trình (giống /api/extract) rồi trả về mã tải, client GET mã đó
// để lấy file. File chờ trong RAM — máy đơn, một tiến trình, như runningCrawls.
const EXPORT_TTL_MS = 5 * 60_000;
// Ảnh nhiều thì tiến trình bắn mỗi ảnh một dòng; gộp lại để không dội hàng nghìn
// dòng vô ích qua mạng và hàng nghìn lần render ở giao diện.
const PROGRESS_INTERVAL_MS = 150;

const pendingExports = new Map<string, { buffer: Buffer; fileName: string }>();

function stashExport(buffer: Buffer, fileName: string): string {
  const exportId = randomUUID();
  pendingExports.set(exportId, { buffer, fileName });
  // unref: bản tải chờ hết hạn không được giữ tiến trình sống.
  setTimeout(() => pendingExports.delete(exportId), EXPORT_TTL_MS).unref();
  return exportId;
}

// Dựng sách và stream tiến trình ra response. Lỗi đi trong luồng chứ không phải
// mã HTTP: header đã gửi từ trước khi biết build có thành công hay không.
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
    // Luôn gửi lúc đổi giai đoạn và lúc xong một giai đoạn: nếu để bộ gộp nuốt
    // mất, giao diện sẽ đứng ở "Đang tải ảnh 651/651…" suốt lúc đóng gói.
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
    send({ type: "error", message: err instanceof Error ? err.message : "Lỗi export EPUB" });
  }
  res.end();
}

// Lấy file đã dựng xong. Tải một lần rồi bỏ: không giữ hàng chục MB trong RAM
// lâu hơn mức cần.
router.get("/exports/:exportId", (req, res) => {
  const pending = pendingExports.get(req.params.exportId);
  if (!pending) {
    res.status(404).json({ message: "Bản xuất đã hết hạn hoặc đã tải rồi — bấm Xuất EPUB lại" });
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
    res.status(400).json({ message: "metadata và chapters là bắt buộc" });
    return;
  }
  await streamExport(res, metadata, chapters, epubFileName(metadata.title || "book"));
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

// Danh sách chương không kèm nội dung: truyện vài nghìn chương đã crawl nặng
// hàng chục MB nếu gửi cả blocks, trong khi bảng chương chỉ cần tên + trạng
// thái. Nội dung từng chương lấy riêng ở /stories/:id/chapters/:order.
router.get("/stories/:id", async (req, res) => {
  const story = await storyStore.getOutline(req.params.id);
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
  res.json({ story: await storyStore.getOutline(id) });
});

// Nội dung một chương, tải khi người dùng mở chương đó ra xem/sửa.
router.get("/stories/:id/chapters/:order", async (req, res) => {
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: "Số thứ tự chương không hợp lệ" });
    return;
  }
  const chapter = await storyStore.getChapter(req.params.id, order);
  if (!chapter) {
    res.status(404).json({ message: "Không tìm thấy chương" });
    return;
  }
  res.json({ chapter });
});

// Xuất EPUB cho truyện đã lưu: nội dung lấy thẳng từ DB, client chỉ gửi những
// chương nó đang sửa dở — không phải tải cả truyện về rồi đẩy ngược lên.
router.post("/stories/:id/export", async (req, res) => {
  const { id } = req.params;
  const { metadata, chapters } = req.body as {
    metadata?: BookMetadata;
    chapters?: { order: number; title?: string; contentHtml?: string }[];
  };
  if (!metadata || !Array.isArray(chapters)) {
    res.status(400).json({ message: "metadata và chapters là bắt buộc" });
    return;
  }

  const story = await storyStore.get(id);
  if (!story) {
    res.status(404).json({ message: "Không tìm thấy truyện" });
    return;
  }

  try {
    const byOrder = new Map(story.chapters.map((c) => [c.order, c]));
    const included: ExportChapter[] = [];
    for (const wanted of chapters) {
      const stored = byOrder.get(wanted.order);
      // Chương client gửi kèm nội dung (đang sửa dở) thì dùng bản đó; còn lại
      // dựng từ block đã lưu.
      // Chuỗi rỗng (chương mở ra nhưng tải nội dung hỏng) cũng rơi về bản
      // trong DB, để không lẳng lặng xuất ra chương trắng.
      const contentHtml = wanted.contentHtml || (stored ? blocksToHtml(stored.blocks ?? []) : "");
      if (!contentHtml) continue;
      included.push({ title: wanted.title ?? stored?.title ?? "", includeInBook: true, contentHtml });
    }

    await streamExport(res, metadata, included, epubFileName(metadata.title || story.title || "book"));
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : "Lỗi export EPUB" });
  }
});

// Sửa tên và nội dung một chương. Nội dung crawl về thường lẫn thông tin thừa
// của trang nguồn (lời web, quảng cáo, tên chương lặp lại), nên người dùng dọn
// lại trong khung soạn thảo rồi lưu đè bản đã sửa.
router.patch("/stories/:id/chapters/:order", async (req, res) => {
  const { id } = req.params;
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: "Số thứ tự chương không hợp lệ" });
    return;
  }
  // Crawl đang chạy sẽ ghi đè chương bằng bản vừa trích xuất, nên chặn sửa để
  // người dùng không mất công dọn xong rồi bị đè mất.
  if (runningCrawls.has(id)) {
    res.status(409).json({ message: "Truyện đang được crawl, không sửa được chương" });
    return;
  }

  const chapter = await storyStore.getChapter(id, order);
  if (!chapter) {
    res.status(404).json({ message: "Không tìm thấy chương" });
    return;
  }

  const { title, contentHtml } = req.body as { title?: string; contentHtml?: string };
  if (!title?.trim()) {
    res.status(400).json({ message: "Tên chương là bắt buộc" });
    return;
  }
  if (typeof contentHtml !== "string") {
    res.status(400).json({ message: "Nội dung chương là bắt buộc" });
    return;
  }

  const blocks = htmlToBlocks(contentHtml);
  if (blocks.length === 0) {
    res.status(400).json({ message: "Nội dung chương không được để trống" });
    return;
  }

  // Chương crawl lỗi mà người dùng tự dán nội dung vào coi như đã xong: nó được
  // tính vào sách và "Crawl tiếp" không crawl lại để ghi đè nữa.
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
        send({ type: "progress", index: i, cursor: i + 1, total: plan.length, url: chapter.url, message: `Đang tải & trích xuất...${attemptSuffix}` });
      });

      const stored = story.chapters.find((c) => c.order === chapter.order);
      if (stored) {
        stored.status = extracted.error ? "error" : "done";
        stored.error = extracted.error;
        stored.blocks = extracted.error ? undefined : extracted.blocks;
        if (!extracted.error) stored.title = pickChapterTitle(stored.title, extracted.title, stored.url);
        await storyStore.saveChapter(story.id, stored);
      }

      if (extracted.error) {
        send({ type: "error", index: i, cursor: i + 1, total: plan.length, url: chapter.url, message: extracted.error });
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
