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
  errorKind?: ChapterErrorKind;
}

export interface SupportedSite {
  domain: string;
  name: string;
}

export interface ProgressEvent {
  // "chapter-done": one chapter complete (with `url`). Explicit instead of
  // inferring from next chapter starting — that inference can't mark the last
  // chapter. "done" is still the entire crawl complete.
  type: "progress" | "error" | "done" | "chapter-done" | "running" | "idle";
  index?: number;
  cursor?: number;
  total?: number;
  url?: string;
  message?: string;
  chapters?: ExtractedChapter[];
  // Estimated time remaining (ms) for running crawl; absent when there aren't
  // enough samples to estimate yet.
  etaMs?: number;
}

export interface BookMetadata {
  title: string;
  author: string;
  language: string;
  coverUrl?: string;
}

export type ChapterStatus = "pending" | "done" | "error";

// Why a crawl failed; the UI shows "locked"/"subscribers"/"mature" chapters differently from plain errors.
export type ChapterErrorKind = "locked" | "subscribers" | "mature" | "other";

export interface StoredChapter {
  order: number;
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
  language?: string;
  coverUrl?: string;
  watching: boolean;
  newChapterCount: number;
  lastCheckedAt?: string;
  checkError?: string;
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
  watching: boolean;
  newChapterCount: number;
  lastCheckedAt?: string;
  checkError?: string;
  updatedAt: string;
}

export interface AppSettings {
  autoScanOnOpen: boolean;
  defaultBookLanguage: string;
  defaultAuthor: string;
}

// Read-only facts about this installation, shown beside the settings.
export interface AppInfo {
  version: string;
  dataDir: string;
  storyCount: number;
  chapterCount: number;
  privateConfigured: boolean;
}

// GET /api/app-update — whether a newer release exists (src/services/appUpdate.ts).
export interface AppUpdateInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  zipUrl: string | null;
}
