import { apiFetch, langHeaders, readJsonError, tr } from "./http";

// The "Plot twist" chapter (routes/plotTwist.ts): the agent writes it in the background and
// the page polls this state.
export interface PlotTwistState {
  narratable: boolean;
  ready: boolean;
  exists: boolean;
  run?: { status: "running" | "done" | "error"; step?: "scan" | "write"; done: number; total: number; error?: string };
}

const base = (storyId: string) => `/api/stories/${encodeURIComponent(storyId)}/plot-twist`;

export async function fetchPlotTwistState(storyId: string): Promise<PlotTwistState> {
  const res = await apiFetch(base(storyId), { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load the plot twist state")));
  return (await res.json()) as PlotTwistState;
}

export async function startPlotTwist(storyId: string): Promise<void> {
  const res = await apiFetch(base(storyId), { method: "POST", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not start the plot twist chapter")));
}

export async function stopPlotTwist(storyId: string): Promise<void> {
  const res = await apiFetch(`${base(storyId)}/stop`, { method: "POST", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not stop the plot twist chapter")));
}
