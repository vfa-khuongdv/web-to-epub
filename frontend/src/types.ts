export type BlockType = "heading" | "paragraph" | "image";

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
  type: "progress" | "error" | "done";
  index?: number;
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
