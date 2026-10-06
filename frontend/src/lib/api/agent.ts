import { apiFetch, langHeaders, readJsonError, tr } from "./http";

export interface AgentInfo {
  id: string;
  name: string;
  // The command is installed on this computer.
  installed: boolean;
}

export interface AgentConfig {
  enabled: boolean;
  agent: string | null;
  model: string;
  // On, and the chosen agent is still installed: the crawler can run.
  ready: boolean;
  agents: AgentInfo[];
}

export interface AgentConfigPatch {
  enabled?: boolean;
  agent?: string;
  model?: string;
}

export async function fetchAgentConfig(): Promise<AgentConfig> {
  const res = await apiFetch("/api/agent-crawler/config", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load the agent crawler settings")));
  return (await res.json()) as AgentConfig;
}

export async function fetchAgentModels(agent: string): Promise<string[]> {
  const res = await apiFetch(`/api/agent-crawler/models?agent=${encodeURIComponent(agent)}`, { headers: langHeaders() });
  if (!res.ok) return [];
  return ((await res.json()) as { models: string[] }).models;
}

export async function clearAgentActivity(): Promise<void> {
  const res = await apiFetch("/api/agent-crawler/activity", { method: "DELETE", headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not clear the agent log")));
}

export async function saveAgentConfig(patch: AgentConfigPatch): Promise<void> {
  const res = await apiFetch("/api/agent-crawler/config", {
    method: "PUT",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save the agent crawler settings")));
}

export interface StoryAgentCrawler {
  // The story's site is crawled by code the agent wrote.
  available: boolean;
  // The agent crawler is on and its agent installed, so it can be asked to rewrite that code.
  ready: boolean;
}

export async function fetchStoryAgentCrawler(storyId: string): Promise<StoryAgentCrawler> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/agent-crawler`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load the agent crawler settings")));
  return (await res.json()) as StoryAgentCrawler;
}

// Takes as long as the agent does (a minute or more); the Agent log shows the steps meanwhile.
export async function rewriteStoryAgentCrawler(storyId: string): Promise<void> {
  const res = await apiFetch(`/api/stories/${encodeURIComponent(storyId)}/agent-crawler/rewrite`, {
    method: "POST",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("The agent could not rewrite the crawler")));
}
