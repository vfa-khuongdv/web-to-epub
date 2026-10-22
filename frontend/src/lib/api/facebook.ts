import { FacebookStatus, FacebookStoryState } from "../../types";
import { apiFetch, langHeaders, readJsonError, tr } from "./http";

// Facebook Page posting (routes/facebook.ts). The Page and its token are install-wide; the
// upload job is per story and reports on the same /api/youtube/live channel.
export async function fetchFacebookStatus(): Promise<FacebookStatus> {
  const res = await apiFetch("/api/facebook/status", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load the Facebook settings")));
  return (await res.json()) as FacebookStatus;
}

export async function connectFacebook(pageId: string, token: string): Promise<FacebookStatus> {
  const res = await apiFetch("/api/facebook/account", {
    method: "PUT",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ pageId, token }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not connect Facebook")));
  return (await res.json()) as FacebookStatus;
}

export async function disconnectFacebook(): Promise<void> {
  const res = await apiFetch("/api/facebook/account", { method: "DELETE", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not disconnect Facebook")));
}

export async function fetchFacebookStory(storyId: string): Promise<FacebookStoryState> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/facebook`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load the Facebook state")));
  return (await res.json()) as FacebookStoryState;
}

export async function uploadFacebook(storyId: string, orders?: number[]): Promise<{ total: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/facebook/upload`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ orders }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not start the Facebook upload")));
  return (await res.json()) as { total: number };
}

export async function uploadFacebookCompilation(storyId: string, ids?: string[]): Promise<{ total: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/facebook/compilation/upload`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not start the Facebook upload")));
  return (await res.json()) as { total: number };
}
