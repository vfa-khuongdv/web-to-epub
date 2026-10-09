/**
 * What the app remembers about posting a story's chapter videos to a Facebook Page. The
 * video itself is the one the YouTube "render" step wrote, and its title/description are
 * the ones prepared there — Facebook only keeps its own upload state, so a chapter posted
 * here is never posted again.
 */
export type FacebookChapterStatus = "uploading" | "uploaded" | "error";

export interface FacebookVideoRecord {
  order: number;
  status: FacebookChapterStatus;
  videoId?: string;
  videoUrl?: string;
  // ISO 8601; set only when Facebook accepted the schedule, otherwise the video stays unpublished.
  scheduledAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** A story's compilation part (several chapters joined into one video) posted to the Page. */
export interface FacebookCompilationRecord {
  id: string;
  status: FacebookChapterStatus;
  videoId?: string;
  videoUrl?: string;
  scheduledAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
