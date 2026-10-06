import { settingsStore } from "../settingsStore";
import { AgentId, findAgentBinary, runAgent } from "./agentCli";

/**
 * Agent crawler: crawl a site the app has no adapter for by having a coding agent that is already
 * installed here (opencode, Claude Code, Codex) write the crawler for it. Off by default; when on,
 * `agent` is the CLI that is asked.
 */
export interface AgentConfig {
  enabled: boolean;
  agent?: AgentId;
  // Empty = the agent's own default model.
  model?: string;
}

export const AGENTS: { id: AgentId; name: string }[] = [
  { id: "opencode", name: "opencode" },
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
];

// Asked one prompt, answers with free text. The crawler writes code through this.
export interface AgentModel {
  // Shown in the activity log.
  name?: string;
  complete(prompt: string): Promise<string>;
}

const KEY = "agentCrawler";

export function loadAgentConfig(): AgentConfig {
  try {
    const raw = settingsStore.getRaw(KEY);
    return { enabled: false, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { enabled: false };
  }
}

export function saveAgentConfig(config: AgentConfig): void {
  settingsStore.setRaw(KEY, JSON.stringify(config));
}

export const installedAgents = (): AgentId[] => AGENTS.filter((a) => findAgentBinary(a.id)).map((a) => a.id);

// The agent to crawl with, or undefined when the feature is off or the chosen agent is gone.
export function activeAgent(): AgentModel | undefined {
  const { enabled, agent, model } = loadAgentConfig();
  if (!enabled || !agent || !findAgentBinary(agent)) return undefined;
  return { name: AGENTS.find((a) => a.id === agent)?.name, complete: (prompt) => runAgent(agent, prompt, model || undefined) };
}
