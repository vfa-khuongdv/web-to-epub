export type BlockType = "heading" | "paragraph" | "image";

export interface ContentBlock {
  type: BlockType;
  level?: number; // for headings: 1-6
  text?: string; // for heading/paragraph, HTML-safe text
  src?: string; // for image
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
  type: "progress" | "done" | "error" | "running" | "idle";
  index?: number;
  cursor?: number;
  total?: number;
  url?: string;
  message?: string;
  chapters?: ExtractedChapter[];
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
  updatedAt: string;
}
