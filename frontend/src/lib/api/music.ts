import { MusicTrack } from "../../types";
import { apiFetch, langHeaders, readJsonError, tr } from "./http";

// `defaultId` is the track the app plays by default (marked in the shipped manifest), or
// null when there is none or the user removed it.
export async function fetchMusicTracks(): Promise<{ tracks: MusicTrack[]; defaultId: string | null }> {
  const res = await apiFetch("/api/music", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load background music")));
  const body = (await res.json()) as { tracks: MusicTrack[]; defaultId?: string | null };
  return { tracks: body.tracks, defaultId: body.defaultId ?? null };
}

export async function uploadMusicTrack(name: string, file: File): Promise<MusicTrack> {
  const res = await apiFetch(`/api/music?${new URLSearchParams({ name })}`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/octet-stream" }),
    body: file,
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not add the music")));
  return (await res.json()) as MusicTrack;
}

export async function deleteMusicTrack(id: string): Promise<void> {
  const res = await apiFetch(`/api/music/${encodeURIComponent(id)}`, { method: "DELETE", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not remove the music")));
}

// Shared by both libraries, so no vault token.
export function musicAudioUrl(id: string): string {
  return `/api/music/${encodeURIComponent(id)}/audio`;
}
