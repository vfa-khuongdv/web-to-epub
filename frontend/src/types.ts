export type BlockType = "heading" | "paragraph" | "image" | "audio" | "video";

export interface ContentBlock {
  type: BlockType;
  level?: number;
  text?: string;
  src?: string;
  alt?: string;
}

export interface ExtractedChapter {
  sourceUrl: string;
  title: string;
  blocks: ContentBlock[];
  error?: string;
}

export interface SupportedSite {
  domain: string;
  name: string;
}

export interface ProgressEvent {
  // "chapter-done": xong một chương (kèm `url`). Báo đích danh thay vì để giao
  // diện suy ra từ việc chương sau bắt đầu — phép suy đó không đánh dấu được
  // chương cuối cùng. "done" vẫn là xong cả lần crawl.
  type: "progress" | "error" | "done" | "chapter-done" | "running" | "idle";
  index?: number;
  cursor?: number;
  total?: number;
  url?: string;
  message?: string;
  chapters?: ExtractedChapter[];
}

export interface BookMetadata {
  title: string;
  author: string;
  language: string;
  coverUrl?: string;
}

export type ChapterStatus = "pending" | "done" | "error";

export interface StoredChapter {
  order: number;
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
  language?: string;
  coverUrl?: string;
  chapters: StoredChapter[];
  createdAt: string;
  updatedAt: string;
}

export interface StorySummary {
  id: string;
  storyUrl: string;
  site: string;
  title: string;
  chapterCount: number;
  doneCount: number;
  errorCount: number;
  updatedAt: string;
}
