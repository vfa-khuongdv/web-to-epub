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
  type: "progress" | "done" | "error";
  index?: number;
  total?: number;
  url?: string;
  message?: string;
  chapters?: ExtractedChapter[];
}
