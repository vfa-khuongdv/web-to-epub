export type BlockType = "heading" | "paragraph" | "image" | "audio" | "video";

export interface ContentBlock {
  type: BlockType;
  level?: number; // for headings: 1-6
  text?: string; // for heading/paragraph, HTML-safe text
  src?: string; // for image/audio/video
  alt?: string; // for image
}

export interface ExtractedChapter {
  sourceUrl: string;
  title: string;
  blocks: ContentBlock[];
  error?: string; // set when extraction failed after retries; blocks will be empty
}

export interface ExtractRequest {
  urls: string[];
}

export interface ExportChapter {
  title: string;
  includeInBook: boolean;
  contentHtml: string; // final edited HTML for this chapter's body
}

export interface BookMetadata {
  title: string;
  author: string;
  language: string;
  coverUrl?: string; // remote URL or uploaded file path
}

export interface ExportRequest {
  metadata: BookMetadata;
  chapters: ExportChapter[];
}

export interface ProgressEvent {
  // "chapter-done": xong một chương (kèm `url`). Báo đích danh thay vì để giao
  // diện suy ra từ việc chương sau bắt đầu — phép suy đó không đánh dấu được
  // chương cuối cùng. "done" vẫn là xong cả lần crawl.
  type: "progress" | "done" | "error" | "chapter-done" | "running" | "idle";
  index?: number;
  cursor?: number;
  total?: number;
  url?: string;
  message?: string;
  chapters?: ExtractedChapter[];
  // Thời gian còn lại ước lượng (ms) cho lần crawl đang chạy; vắng mặt khi
  // chưa đủ mẫu để ước lượng (xem estimateRemainingMs).
  etaMs?: number;
}

export type ChapterStatus = "pending" | "done" | "error";

export interface StoredChapter {
  order: number; // vị trí trong TOC, bắt đầu từ 1
  url: string;
  title: string;
  status: ChapterStatus;
  error?: string;
  blocks?: ContentBlock[];
}

export interface StoredStory {
  id: string;
  storyUrl: string;
  site: string;
  title: string;
  author?: string;
  language?: string; // ngôn ngữ sách, dùng cho EPUB; mặc định "vi" ở giao diện
  coverUrl?: string;
  // Theo dõi chương mới: bật thì app kiểm tra TOC khi mở; kết quả lần kiểm tra
  // gần nhất (số chương mới + lỗi nếu có) lưu lại để hiện chip trong thư viện.
  watching: boolean;
  newChapterCount: number;
  lastCheckedAt?: string; // ISO, lần kiểm tra thành công gần nhất
  checkError?: string;
  chapters: StoredChapter[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface StorySummary {
  id: string;
  storyUrl: string;
  site: string;
  title: string;
  chapterCount: number;
  doneCount: number;
  errorCount: number;
  watching: boolean;
  newChapterCount: number;
  lastCheckedAt?: string;
  checkError?: string;
  updatedAt: string;
}
