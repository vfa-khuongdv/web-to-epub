import { YouTubeCompilation, YouTubeCompilationPlan, YouTubeConfig, YouTubeState, YouTubeStatus, YouTubeVideoRecord } from "../../types";
import { apiFetch, apiError, langHeaders, readJsonError, tr } from "./http";

// YouTube publishing (routes/youtube.ts). The account and settings are install-wide; the
// prepare/render/upload jobs are per story and report on /api/youtube/live.
export async function fetchYouTubeStatus(): Promise<YouTubeStatus> {
  const res = await apiFetch("/api/youtube/status", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load the YouTube settings")));
  return (await res.json()) as YouTubeStatus;
}

export async function saveYouTubeSettings(patch: Partial<YouTubeConfig>): Promise<YouTubeConfig> {
  const res = await apiFetch("/api/youtube/config", {
    method: "PUT",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save the YouTube settings")));
  return ((await res.json()) as { config: YouTubeConfig }).config;
}

export async function connectYouTube(clientSecretPath?: string): Promise<{ url: string }> {
  const res = await apiFetch("/api/youtube/connect", {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(clientSecretPath !== undefined ? { clientSecretPath } : {}),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not start the YouTube sign-in")));
  return (await res.json()) as { url: string };
}

export async function disconnectYouTube(): Promise<void> {
  const res = await apiFetch("/api/youtube/account", { method: "DELETE", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not sign out of YouTube")));
}

// Story-level credits (author / translator / genre tags) the upload info is built from.
export async function saveYouTubeCredits(
  storyId: string,
  patch: { author?: string; translator?: string; genreTags?: string }
): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube`, {
    method: "PATCH",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save the general info")));
}

export interface YouTubeSyncResult {
  imported: number;
  // Records that were already marked uploaded but only now got their description/tags.
  updated: number;
  playlistTitle: string;
  playlistExists: boolean;
}

// Marks the chapters already on the channel as uploaded (videos the upload script made
// are not in this library). Read-only against YouTube; safe to call again.
export async function syncYouTube(storyId: string): Promise<YouTubeSyncResult> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/sync`, {
    method: "POST",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not sync with YouTube")));
  return (await res.json()) as YouTubeSyncResult;
}

export async function fetchYouTubeStory(storyId: string): Promise<YouTubeState> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load the YouTube panel")));
  return (await res.json()) as YouTubeState;
}

export interface PrepareYouTubeInput {
  orders: number[];
  musicId?: string;
  musicVolume?: number;
  publishAt?: Record<number, string>;
  author?: string;
  translator?: string;
  genreTags?: string;
}

export async function prepareYouTube(storyId: string, input: PrepareYouTubeInput): Promise<{ total: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/prepare`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not prepare the upload info")));
  return (await res.json()) as { total: number };
}

export async function renderYouTube(
  storyId: string,
  orders?: number[],
  music?: { musicId?: string; musicVolume?: number }
): Promise<{ total: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/render`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ...(orders ? { orders } : {}), ...(music ?? {}) }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not start making the videos")));
  return (await res.json()) as { total: number };
}

export async function uploadYouTube(
  storyId: string,
  orders?: number[],
  createPlaylist?: boolean
): Promise<{ total: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/upload`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ orders, createPlaylist: createPlaylist === true }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw apiError(data?.message || tr("Could not start the upload"), res.status, data?.code);
  }
  return (await res.json()) as { total: number };
}

export async function stopYouTube(storyId: string): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/stop`, {
    method: "POST",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not stop the YouTube job")));
}

export interface RenderCompilationInput {
  orders: number[];
  intro?: string;
  labelWord?: string;
  musicId?: string;
  musicVolume?: number;
  publishAt?: Record<number, string>;
}

// Writes the compilation's story intro with the agent (agent setting required).
export async function writeYouTubeIntro(storyId: string, orders: number[]): Promise<{ intro: string }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/compilation/intro`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ orders }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not write the intro")));
  return (await res.json()) as { intro: string };
}

// Plans the compilation: parts and hours, plus chapters still missing narration audio.
export async function planYouTubeCompilation(storyId: string, orders: number[]): Promise<YouTubeCompilationPlan> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/compilation/plan`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ orders }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not plan the compilation")));
  return (await res.json()) as YouTubeCompilationPlan;
}

export async function renderYouTubeCompilation(storyId: string, input: RenderCompilationInput): Promise<{ total: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/compilation`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not start making the compilation")));
  return (await res.json()) as { total: number };
}

export async function uploadYouTubeCompilation(
  storyId: string,
  ids?: string[],
  createPlaylist?: boolean
): Promise<{ total: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/compilation/upload`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ids, createPlaylist: createPlaylist === true }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw apiError(data?.message || tr("Could not start the upload"), res.status, data?.code);
  }
  return (await res.json()) as { total: number };
}

export async function deleteYouTubeCompilation(storyId: string, id: string): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/compilation/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not remove this part")));
}

export function youTubeCompilationVideoUrl(storyId: string, id: string): string {
  return `/api/stories/${encodeURIComponent(storyId)}/youtube/compilation/${encodeURIComponent(id)}/video`;
}

export interface YouTubeChapterPatch {
  title?: string;
  description?: string;
  tags?: string;
  // null clears the schedule (upload private without one).
  publishAt?: string | null;
  musicId?: string;
  musicVolume?: number;
}

export async function saveYouTubeChapter(
  storyId: string,
  order: number,
  patch: YouTubeChapterPatch
): Promise<YouTubeVideoRecord> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/${order}`, {
    method: "PATCH",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save this chapter's info")));
  return ((await res.json()) as { record: YouTubeVideoRecord }).record;
}

export async function deleteYouTubeChapter(storyId: string, order: number): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/youtube/${order}`, {
    method: "DELETE",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not remove this chapter's upload info")));
}

// Reschedules a rendered compilation part (the local record only; uploaded parts refuse).
export async function saveYouTubeCompilation(
  storyId: string,
  compilationId: string,
  patch: { publishAt?: string | null }
): Promise<void> {
  const res = await apiFetch(
    `/api/stories/${encodeURIComponent(storyId)}/youtube/compilation/${encodeURIComponent(compilationId)}`,
    {
      method: "PATCH",
      headers: langHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    }
  );
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save the schedule")));
}

// The rendered MP4, for the preview player (Range-capable).
export function youTubeVideoUrl(storyId: string, order: number): string {
  return `/api/stories/${encodeURIComponent(storyId)}/youtube/${order}/video`;
}
