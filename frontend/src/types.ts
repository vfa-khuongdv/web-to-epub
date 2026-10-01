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

// A source the add box accepts. "crawl" = the chapter list is loaded from the pasted URL;
// "import" = the source hosts a whole book file that is read instead (archive.org,
// dtv-ebook.com.vn, heyzine.com). Both are supported, and the UI says which kind a domain is.
export type SupportedSiteMode = "crawl" | "import";

export interface SupportedSite {
  domain: string;
  name: string;
  mode: SupportedSiteMode;
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
  // The reader marked the chapter's typos as fixed; a re-crawl clears it.
  spellChecked?: boolean;
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
  // Narration model: VieNeu's "turbo" (quality) or "nano" (fast), or "omnivoice" (the
  // other engine, which only reads with a custom voice). Preset voice; "" = model default.
  ttsVariant: TtsVariant;
  ttsVoice: string;
}

export type TtsVariant = "turbo" | "nano" | "omnivoice";

// Each engine is a separate install (src/services/tts/runtime.ts ttsRuntimes).
export type TtsEngine = "vieneu" | "omnivoice";

// Mirrors TtsStatus in src/services/tts/runtime.ts.
export interface TtsStatus {
  engine: TtsEngine;
  supported: boolean;
  state: "not-installed" | "installing" | "installed" | "error";
  phase?: "uv" | "python" | "packages" | "model";
  downloaded?: number;
  total?: number;
  error?: string;
  version: string;
  running: boolean;
  busy: boolean;
  diskBytes?: number;
}

// A narration job's position, as the server reports it (routes/narration.ts).
export interface NarrationRun {
  done: number;
  total: number;
  etaMs?: number;
  order?: number;
  part?: number;
  parts?: number;
}

export interface NarrationState {
  narratable: boolean;
  // Per readable chapter: audio matching its current text and voice, or not.
  chapters: Record<number, "ready" | "missing">;
  bytes: number;
  running: NarrationRun | null;
}

export interface TtsVoice {
  id: string;
  label: string;
  // Cloned from a clip the user uploaded (id `custom:<id>`), usable with every model.
  custom?: boolean;
}

// A music file the user uploaded to play under the narration (in-app player only).
export interface MusicTrack {
  id: string;
  name: string;
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
