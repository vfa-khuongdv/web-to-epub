import { apiFetch, langHeaders, readJsonError, tr } from "./http";

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface Highlight {
  id: string;
  chapterOrder: number;
  start: number;
  end: number;
  color: HighlightColor;
  text: string;
  createdAt: string;
}

export async function fetchHighlights(storyId: string): Promise<Highlight[]> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/highlights`, {
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load highlights")));
  return (await res.json()).highlights as Highlight[];
}

export async function createHighlight(
  storyId: string,
  highlight: Omit<Highlight, "id" | "createdAt">
): Promise<Highlight> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/highlights`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(highlight),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save the highlight")));
  return (await res.json()).highlight as Highlight;
}

export async function recolorHighlight(storyId: string, id: string, color: HighlightColor): Promise<void> {
  const res = await apiFetch(
    `/api/stories/${encodeURIComponent(storyId)}/highlights/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: langHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ color }),
    }
  );
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not change the highlight colour")));
}

export async function deleteHighlight(storyId: string, id: string): Promise<void> {
  const res = await apiFetch(
    `/api/stories/${encodeURIComponent(storyId)}/highlights/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: langHeaders() }
  );
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not delete the highlight")));
}
