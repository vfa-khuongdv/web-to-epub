import { IllustratedState } from "../../types";
import { apiFetch, langHeaders, readJsonError, tr } from "./http";

// Illustrated chapter videos (routes/illustrated.ts): the story's characters are drawn once
// by the agent and reviewed here before any chapter is rendered with them.
export async function fetchIllustrated(storyId: string): Promise<IllustratedState> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/illustrated`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load the characters")));
  return (await res.json()) as IllustratedState;
}

// Asks the agent to read the first chapters and draw the characters; takes a minute or so.
export async function drawCharacters(storyId: string): Promise<IllustratedState> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/illustrated/bible`, {
    method: "POST",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not draw the characters")));
  const data = (await res.json()) as Pick<IllustratedState, "bible">;
  return { bible: data.bible, agentAvailable: true };
}

export async function removeCharacters(storyId: string): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/illustrated`, { method: "DELETE", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not remove the characters")));
}
