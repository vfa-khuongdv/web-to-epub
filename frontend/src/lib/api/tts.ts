import { TtsStatus, TtsEngine, TtsVariant, TtsVoice } from "../../types";
import { apiFetch, langHeaders, readJsonError, tr } from "./http";

// `disk` asks for the installed size too — slower, so only the settings page's first
// load asks, not its progress polling. Without `engine`, the one the current settings
// read with.
export async function fetchTtsStatus(disk = false, engine?: TtsEngine): Promise<TtsStatus> {
  const query = new URLSearchParams();
  if (disk) query.set("disk", "1");
  if (engine) query.set("engine", engine);
  const qs = query.toString();
  const res = await apiFetch(`/api/tts/status${qs ? `?${qs}` : ""}`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not check narration")));
  return (await res.json()) as TtsStatus;
}

export async function installTts(variant: TtsVariant): Promise<TtsStatus> {
  const res = await apiFetch("/api/tts/install", {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ variant }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not install narration")));
  return (await res.json()) as TtsStatus;
}

export async function uninstallTts(engine: TtsEngine): Promise<TtsStatus> {
  const res = await apiFetch(`/api/tts?engine=${engine}`, { method: "DELETE", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not uninstall narration")));
  return (await res.json()) as TtsStatus;
}

export async function fetchTtsVoices(variant: TtsVariant): Promise<TtsVoice[]> {
  const res = await apiFetch(`/api/tts/voices?variant=${variant}`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load voices")));
  return ((await res.json()) as { voices: TtsVoice[] }).voices;
}

// `transcript`: what is said in the clip, if the user typed it ("" lets OmniVoice transcribe).
export async function uploadTtsVoice(name: string, file: File, transcript = ""): Promise<TtsVoice> {
  const query = new URLSearchParams({ name });
  if (transcript.trim()) query.set("transcript", transcript.trim());
  const res = await apiFetch(`/api/tts/voices?${query}`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/octet-stream" }),
    body: file,
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not upload the voice")));
  return (await res.json()) as TtsVoice;
}

export async function deleteTtsVoice(id: string): Promise<void> {
  const res = await apiFetch(`/api/tts/voices/${encodeURIComponent(id)}`, { method: "DELETE", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not remove the voice")));
}

export async function previewTts(variant: TtsVariant, voice: string): Promise<Blob> {
  const res = await apiFetch("/api/tts/preview", {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ variant, voice }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not preview the voice")));
  return res.blob();
}
