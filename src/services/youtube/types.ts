/**
 * What the app remembers about publishing one story to YouTube, kept in the library's own
 * stories.db (so a private story's records stay under data/private/). The YouTube account
 * itself is install-wide (services/youtube/account.ts).
 */
export type YouTubeChapterStatus = "draft" | "rendering" | "rendered" | "uploading" | "uploaded" | "error";

export interface YouTubeVideoRecord {
  order: number;
  status: YouTubeChapterStatus;
  // What will be uploaded (editable in the panel).
  title?: string;
  description?: string;
  // Comma-separated, as the YouTube tags field wants.
  tags?: string;
  // ISO 8601 with an offset; absent = upload private without a schedule.
  publishAt?: string;
  summary?: string;
  musicId?: string;
  musicVolume?: number;
  // Path relative to the library's data dir: youtube/<storyId>/<order>.mp4
  videoPath?: string;
  videoSeconds?: number;
  videoId?: string;
  videoUrl?: string;
  privacy?: string;
  // AudioMeta.text of the audio the video was rendered from, to flag "audio changed".
  audioKey?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type YouTubeCompilationStatus = "rendering" | "rendered" | "uploading" | "uploaded" | "error";

/**
 * One part of a story's compilation (several chapters joined into one long video, split
 * so no part passes YouTube's 12-hour limit — the workspace's `truyen-fm-compilation`
 * skill). Parts live outside `youtube_videos` because they are not chapters.
 */
export interface YouTubeCompilationRecord {
  id: string;
  part: number;
  parts: number;
  // "Trọn bộ Phần 1 (Chương 1–50)" — shown in the panel and in the title.
  label: string;
  fromOrder: number;
  toOrder: number;
  status: YouTubeCompilationStatus;
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

export interface YouTubeStoryRecord {
  storyId: string;
  playlistTitle: string;
  playlistId?: string;
  playlistUrl?: string;
  playlistCheckedAt?: string;
  // Description credits for this story (the app has no translator field of its own).
  author?: string;
  translator?: string;
  genreTags?: string;
  createdAt: string;
  updatedAt: string;
}
