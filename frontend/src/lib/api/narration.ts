import { currentVaultToken } from "../../vault/token";
import { NarrationState } from "../../types";
import { apiFetch, langHeaders, readJsonError, tr } from "./http";

export async function fetchNarration(storyId: string): Promise<NarrationState> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/narration`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load narration")));
  return (await res.json()) as NarrationState;
}

// `regenerate` narrates the chapters again even when they already have audio.
export async function startNarration(
  storyId: string,
  orders?: number[],
  options: { regenerate?: boolean } = {}
): Promise<{ total: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/narrate`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ...(orders ? { orders } : {}), ...(options.regenerate ? { regenerate: true } : {}) }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not start narration")));
  return (await res.json()) as { total: number };
}

export async function stopNarration(storyId: string): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/narrate/stop`, {
    method: "POST",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not stop narration")));
}

// When each part of a chapter's narration plays, and which block it reads (the reader's
// highlight). Blocks index the chapter content's elements; -1 is the title.
export async function fetchNarrationTimeline(
  storyId: string,
  order: number
): Promise<{ block: number; start: number; end: number }[]> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${order}/narration`, {
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load narration")));
  return ((await res.json()) as { parts: { block: number; start: number; end: number }[] }).parts;
}

export async function deleteStoryAudio(storyId: string): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/narration`, {
    method: "DELETE",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not delete the audio")));
}

// Opened by <a href> / <audio src>, which send no headers: the private-mode token rides
// in the query. `download` asks for the attachment file name (the player does not want it).
// A download may carry background music (`music`), which the server mixes into the file.
export function chapterAudioUrl(
  storyId: string,
  order: number,
  options: { download?: boolean; music?: { musicId?: string; musicVolume?: number } } = {}
): string {
  const token = currentVaultToken();
  const params = new URLSearchParams();
  if (token) params.set("vault", token);
  if (options.download) params.set("download", "1");
  if (options.download && options.music?.musicId) {
    params.set("music", options.music.musicId);
    params.set("musicVolume", String(options.music.musicVolume ?? 0.3));
  }
  const query = params.toString();
  return `/api/stories/${encodeURIComponent(storyId)}/chapters/${order}/audio${query ? `?${query}` : ""}`;
}

export interface AudioExport {
  exportId: string;
  fileName: string;
  count: number;
  // Chapters left out because they have no audio.
  missing: number[];
}

export async function exportStoryAudio(storyId: string): Promise<AudioExport & { url: string }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/export-audio`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not export audio")));
  const created = (await res.json()) as AudioExport;
  return { ...created, url: `/api/exports/audio/${encodeURIComponent(created.exportId)}` };
}

export interface AudioMixJob {
  state: "running" | "done" | "error";
  done: number;
  total: number;
  exportId?: string;
  fileName?: string;
  message?: string;
  musicName?: string;
  // Zip format: chapters in the zip, and those left out for having no audio.
  count?: number;
  missing?: number[];
}

// One MP3 of the whole story with background music under it. The server joins it in
// the background (it takes minutes on a long story); poll fetchAudioMix with the job id.
// `format: "zip"` is the zip export with music: one file per chapter instead of one.
export async function startAudioMix(
  storyId: string,
  music: { musicId?: string; musicVolume?: number; format?: "mp3" | "zip" }
): Promise<{ jobId: string; total: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/export-audio-mix`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(music),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not export audio")));
  return (await res.json()) as { jobId: string; total: number };
}

export async function fetchAudioMix(jobId: string): Promise<AudioMixJob & { url?: string }> {
  const res = await apiFetch(`/api/exports/audio-mix/${encodeURIComponent(jobId)}`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not export audio")));
  const job = (await res.json()) as AudioMixJob;
  return job.exportId ? { ...job, url: `/api/exports/audio/${encodeURIComponent(job.exportId)}` } : job;
}
