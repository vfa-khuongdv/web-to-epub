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
