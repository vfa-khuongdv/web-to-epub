export type BlockType = "heading" | "paragraph" | "html" | "image" | "audio" | "video";

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
  coverUrl?: string;
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
  // A sentence introducing the channel is read before a story's first chapter; the text may
  // use {channel} and {title}, empty = the built-in wording.
  narrationIntro: boolean;
  narrationIntroText: string;
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
  // The release's own notes (markdown) from GitHub; null when it has none.
  notes: string | null;
}

// ---- Chapter rewrite for narration (routes/rewrite.ts) ----------------------

export interface RewriteChapterState {
  rewritten: boolean;
  at?: string;
  agent?: string;
}

export interface RewriteRun {
  done: number;
  total: number;
  etaMs?: number;
  order?: number;
  chunk?: number;
  chunks?: number;
}

export interface RewriteState {
  narratable: boolean;
  // The agent is on and installed.
  ready: boolean;
  chapters: Record<number, RewriteChapterState>;
  remaining: number;
  running: RewriteRun | null;
}

// ---- YouTube publishing (routes/youtube.ts) ---------------------------------

export type YouTubeChapterStatus = "draft" | "rendering" | "rendered" | "uploading" | "uploaded" | "error";
export type YouTubePhase = "prepare" | "render" | "upload" | "compilation" | "facebook";

export interface YouTubeVideoRecord {
  order: number;
  status: YouTubeChapterStatus;
  title?: string;
  description?: string;
  tags?: string;
  publishAt?: string;
  summary?: string;
  musicId?: string;
  musicVolume?: number;
  videoPath?: string;
  videoSeconds?: number;
  videoId?: string;
  videoUrl?: string;
  privacy?: string;
  audioKey?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface YouTubeChapterState {
  order: number;
  title: string;
  hasAudio: boolean;
  // Audio length in seconds, for the compilation plan.
  seconds?: number;
  // The video was rendered from audio that has been regenerated since.
  audioChanged: boolean;
  record?: YouTubeVideoRecord;
}

export interface YouTubeRun {
  phase: YouTubePhase;
  done: number;
  total: number;
  etaMs?: number;
  order?: number;
  percent?: number;
}

export interface YouTubeState {
  connected: boolean;
  channel?: string;
  // The agent setting is on: the panel offers the AI actions.
  agentReady: boolean;
  cover: boolean;
  ffmpeg: boolean;
  config: {
    channel: string;
    scheduleTime: string;
    genreTags: string;
    musicId?: string;
    musicVolume: number;
  };
  story: { title: string; author?: string; language?: string };
  playlist: { title: string; id?: string; url?: string; checkedAt?: string; exists: boolean };
  credits: { author?: string; translator?: string; genreTags: string };
  chapters: YouTubeChapterState[];
  // The playlist compilations are uploaded to, and the parts made so far.
  compilationPlaylist: string;
  compilations: YouTubeCompilation[];
  // Parts cut to Facebook's 4 h limit (the ones above are cut to YouTube's 11 h).
  facebookCompilations: YouTubeCompilation[];
  running: YouTubeRun | null;
}

export type YouTubeCompilationStatus = "rendering" | "rendered" | "uploading" | "uploaded" | "error";

// One part of the story's compilation (several chapters in one long video).
export interface YouTubeCompilation {
  id: string;
  part: number;
  parts: number;
  label: string;
  fromOrder: number;
  toOrder: number;
  status: YouTubeCompilationStatus;
  platform?: "youtube" | "facebook";
  title?: string;
  description?: string;
  tags?: string;
  publishAt?: string;
  videoPath?: string;
  videoSeconds?: number;
  videoId?: string;
  videoUrl?: string;
  privacy?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface YouTubeCompilationPlan {
  totalHours: number;
  missing: number[];
  parts: { part: number; from: number; to: number; hours: number }[];
}

export interface YouTubeConfig {
  channel: string;
  clientSecretPath: string;
  ffmpegPath: string;
  genreTags: string;
  scheduleTime: string;
  musicId?: string;
  musicVolume: number;
  syntheticMedia: boolean;
}

export interface YouTubeStatus {
  connected: boolean;
  channel?: string;
  clientSecretPath: string;
  hasClientSecret: boolean;
  ffmpeg: string | null;
  config: YouTubeConfig;
}

export interface FacebookStatus {
  connected: boolean;
  pageName?: string;
  pageUrl?: string;
  pageId?: string;
}

export interface FacebookVideoRecord {
  order: number;
  status: "uploading" | "uploaded" | "error";
  videoId?: string;
  videoUrl?: string;
  scheduledAt?: string;
  error?: string;
}

export interface FacebookStoryState {
  connected: boolean;
  pageName?: string;
  videos: FacebookVideoRecord[];
  // Chapters with a rendered video that are not on the Page yet.
  ready: number[];
  // The joined "full" video(s) of the story, posted as a whole.
  compilations: { id: string; status: "uploading" | "uploaded" | "error"; videoUrl?: string; error?: string }[];
  readyCompilations: { id: string; label: string }[];
}

export interface IllustratedCharacter {
  id: string;
  name: string;
  description: string;
  // Sanitized SVG written by the server's allowlist, drawn around the character's feet at (0,0).
  body: string;
  headY: number;
  faces: Record<"neutral" | "smile" | "sad" | "surprised" | "laugh", string>;
}

export interface IllustratedState {
  bible: { style: string; characters: IllustratedCharacter[] } | null;
  agentAvailable: boolean;
}
