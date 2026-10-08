import { RewriteState } from "../../types";
import { apiFetch, langHeaders, readJsonError, tr } from "./http";

// Chapter rewrite for narration (routes/rewrite.ts). The job runs server-side; its
// progress arrives on /api/rewrite/live (hooks/useRewrite.ts).
export async function fetchRewriteState(storyId: string): Promise<RewriteState> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/rewrite`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load the rewrite state")));
  return (await res.json()) as RewriteState;
}

export async function startRewrite(storyId: string, orders?: number[]): Promise<{ total: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/rewrite`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(orders ? { orders } : {}),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not start the rewrite")));
  return (await res.json()) as { total: number };
}

export async function stopRewrite(storyId: string): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/rewrite/stop`, {
    method: "POST",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not stop the rewrite")));
}

export async function restoreRewrittenChapters(storyId: string, orders?: number[]): Promise<{ restored: number }> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/rewrite`, {
    method: "DELETE",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(orders ? { orders } : {}),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not restore the original text")));
  return (await res.json()) as { restored: number };
}
