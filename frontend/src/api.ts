import { BookMetadata, ProgressEvent, StoredChapter, StoredStory, StorySummary, SupportedSite } from "./types";

export async function fetchSupportedSites(): Promise<SupportedSite[]> {
  const res = await fetch("/api/supported-sites");
  const data = await res.json();
  return data.sites || [];
}

async function readJsonError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.message || fallback;
}

async function streamNdjson<T>(path: string, body: unknown, onEvent: (event: T) => void): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new Error(await readJsonError(res, "Crawl thất bại"));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line));
    }
  }
}

// Streams NDJSON progress events from POST /api/extract, invoking onEvent
// for each line as it arrives.
export async function extractChapters(urls: string[], onEvent: (event: ProgressEvent) => void): Promise<void> {
  await streamNdjson<ProgressEvent>("/api/extract", { urls }, onEvent);
}

// Bắt đầu crawl một truyện: server trả về ngay rồi crawl ở hậu trường, tiến
// trình đến qua kênh realtime /api/stories/:id/live (EventSource).
export async function startStoryCrawl(id: string, orders?: number[]): Promise<{ total: number }> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orders }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, "Không bắt đầu được crawl"));
  return (await res.json()) as { total: number };
}

export async function fetchStories(): Promise<StorySummary[]> {
  const res = await fetch("/api/stories");
  if (!res.ok) throw new Error(await readJsonError(res, "Không tải được danh sách truyện"));
  const data = await res.json();
  return data.stories || [];
}

export async function createStory(url: string): Promise<StoredStory> {
  const res = await fetch("/api/stories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, "Không tải được danh sách chương"));
  const data = await res.json();
  return data.story as StoredStory;
}

export async function fetchStory(id: string): Promise<StoredStory> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(await readJsonError(res, "Không tải được truyện"));
  const data = await res.json();
  return data.story as StoredStory;
}

// Lưu thông tin sách từ khung chi tiết (multipart vì có thể kèm ảnh bìa mới).
export async function saveStoryMeta(id: string, form: FormData): Promise<StoredStory> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}/meta`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await readJsonError(res, "Không lưu được thông tin truyện"));
  const data = await res.json();
  return data.story as StoredStory;
}

// Lưu tên + nội dung một chương người dùng vừa sửa trong khung soạn thảo.
// Server tự chuyển HTML về dạng block đang lưu và trả lại chương sau khi lưu.
export async function saveChapterEdit(
  storyId: string,
  order: number,
  edit: { title: string; contentHtml: string }
): Promise<StoredChapter> {
  const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${order}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(edit),
  });
  if (!res.ok) throw new Error(await readJsonError(res, "Không lưu được chương"));
  const data = await res.json();
  return data.chapter as StoredChapter;
}

export async function deleteStory(id: string): Promise<void> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readJsonError(res, "Không xoá được truyện"));
}

// Bật/tắt theo dõi chương mới cho một truyện.
export async function setStoryWatch(id: string, watching: boolean): Promise<StoredStory> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}/watch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ watching }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, "Không đổi được trạng thái theo dõi"));
  const data = await res.json();
  return data.story as StoredStory;
}

export interface StoryCheckResult {
  newChapterCount: number;
  lastCheckedAt?: string;
  checkError?: string;
}

// Kiểm tra TOC xem truyện có chương mới; throw message khi không fetch được TOC
// (số liệu lần kiểm tra thành công trước đó vẫn được server giữ nguyên).
export async function checkStoryUpdates(id: string): Promise<StoryCheckResult> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}/check`, { method: "POST" });
  if (!res.ok) throw new Error(await readJsonError(res, "Không kiểm tra được chương mới"));
  return (await res.json()) as StoryCheckResult;
}

// Nạp lại TOC cho truyện đã có: chương mới thành pending, chương cũ giữ nguyên.
export async function refreshStoryToc(id: string): Promise<StoredStory> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}/refresh`, { method: "POST" });
  if (!res.ok) throw new Error(await readJsonError(res, "Không tải được danh sách chương mới"));
  const data = await res.json();
  return data.story as StoredStory;
}

export async function uploadCover(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("cover", file);
  const res = await fetch("/api/cover-upload", { method: "POST", body: formData });
  if (!res.ok) {
    throw new Error(await readJsonError(res, "Upload cover thất bại"));
  }
  const data = await res.json();
  return data.path as string;
}

// Nội dung một chương, tải khi người dùng mở chương ra xem/sửa (chi tiết truyện
// không còn kèm nội dung để tránh tải hàng chục MB mỗi lần mở truyện).
export async function fetchChapterContent(storyId: string, order: number): Promise<StoredChapter> {
  const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${order}`);
  if (!res.ok) throw new Error(await readJsonError(res, "Không tải được nội dung chương"));
  const data = await res.json();
  return data.chapter as StoredChapter;
}

// Xuất EPUB cho truyện đã lưu: chỉ gửi chương nào đang sửa dở, phần còn lại
// server dựng từ nội dung trong DB.
export interface StoryExportChapter {
  order: number;
  title: string;
  contentHtml?: string;
}

// Tiến trình dựng sách: phần lớn thời gian là tải ảnh trong chương về.
export interface ExportProgress {
  phase: "images" | "media" | "packaging";
  done: number;
  total: number;
}

interface ExportEvent extends Partial<ExportProgress> {
  type: "progress" | "done" | "error";
  exportId?: string;
  message?: string;
}

// Server stream tiến trình rồi trả mã tải; file lấy ở request thứ hai vì một
// response không thể vừa là luồng tiến trình vừa là file nhị phân.
async function runExport(
  path: string,
  body: unknown,
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  let exportId: string | undefined;
  let failure: string | undefined;

  await streamNdjson<ExportEvent>(path, body, (event) => {
    if (event.type === "progress" && event.phase) {
      onProgress?.({ phase: event.phase, done: event.done ?? 0, total: event.total ?? 0 });
    } else if (event.type === "done") {
      exportId = event.exportId;
    } else if (event.type === "error") {
      failure = event.message;
    }
  });

  if (failure) throw new Error(failure);
  if (!exportId) throw new Error("Export thất bại — luồng kết thúc mà không có file");

  const res = await fetch(`/api/exports/${encodeURIComponent(exportId)}`);
  if (!res.ok) throw new Error(await readJsonError(res, "Không tải được file EPUB vừa dựng"));
  return res.blob();
}

export async function exportStoryEpub(
  storyId: string,
  metadata: BookMetadata,
  chapters: StoryExportChapter[],
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  return runExport(`/api/stories/${encodeURIComponent(storyId)}/export`, { metadata, chapters }, onProgress);
}

export interface ExportChapterPayload {
  title: string;
  includeInBook: boolean;
  contentHtml: string;
}

export async function exportEpub(
  metadata: BookMetadata,
  chapters: ExportChapterPayload[],
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  return runExport("/api/export", { metadata, chapters }, onProgress);
}
