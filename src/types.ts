export type BlockType = "heading" | "paragraph" | "image" | "audio" | "video";

// Why a crawl failed. "locked" means a retry cannot change the outcome until the site
// grants access (missing/expired login, mature opt-in, subscribers-only content); "other"
// is everything else, where retrying may well work. The UI reacts to this instead of
// matching message text, which is translated.
export type ChapterErrorKind = "locked" | "other";

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
  errorKind?: ChapterErrorKind;
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

export interface ProgressEvent {
  // "chapter-done": one chapter finished (with `url`). Report specifically instead of
  // letting UI infer from the next chapter starting — that inference can't mark the
  // final chapter. "done" still means the entire crawl completed.
  type: "progress" | "done" | "error" | "chapter-done" | "running" | "idle";
  index?: number;
  cursor?: number;
  total?: number;
  url?: string;
  message?: string;
  chapters?: ExtractedChapter[];
  // Remaining time estimate (ms) for the current crawl; absent when insufficient
  // samples to estimate (see estimateRemainingMs).
  etaMs?: number;
}

export type ChapterStatus = "pending" | "done" | "error";

export interface StoredChapter {
  order: number; // position in TOC, starting from 1
  url: string;
  title: string;
  status: ChapterStatus;
  error?: string;
  errorKind?: ChapterErrorKind;
  blocks?: ContentBlock[];
}

export interface StoredStory {
  id: string;
  storyUrl: string;
  site: string;
  title: string;
  author?: string;
  language?: string; // book language for EPUB; defaults to "vi" in UI
  coverUrl?: string;
  // Watch for new chapters: when enabled, app checks TOC on launch; the most recent
  // check result (new chapter count + error if any) is saved to display a chip in library.
  watching: boolean;
  newChapterCount: number;
  lastCheckedAt?: string; // ISO, most recent successful check
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
