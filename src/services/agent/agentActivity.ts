/**
 * What the agent crawler is doing, step by step, for the page to show live. The steps are data (kind,
 * host, numbers), not sentences, so the page words them in its own language. A short history is kept
 * so a page opened — or reloaded — mid-run still sees what happened. Single process, like the crawl
 * and narration channels.
 */
export type AgentStepKind =
  | "classify" // the agent is asked whether the URL is the home page of a story
  | "verdict" // its answer (`verdict`: story / document / other, `reason`)
  | "ask" // the agent was asked to write code (attempt of `of`)
  | "answer" // it answered; the code is now tried on the page
  | "retry" // that code did not work
  | "saved" // code accepted and saved; `count` = chapters / blocks it produced
  | "reuse" // saved code is used (once per site and part per session)
  | "stale" // saved code stopped working; the person decides whether to rewrite it
  | "failed" // the agent gave up after every attempt
  | "locked"; // the page asks for a login, which is not bypassed

export interface AgentStep {
  kind: AgentStepKind;
  host: string;
  // "url" = what kind of page the address is, "toc" = the story and its chapter list, "chapter" = one chapter's text.
  fn: "url" | "toc" | "chapter" | "article";
  agent?: string;
  attempt?: number;
  of?: number;
  ms?: number;
  count?: number;
  reason?: string;
  verdict?: string;
}

export interface AgentActivityEvent extends AgentStep {
  id: number;
  at: number;
}

const MAX_HISTORY = 200;
const history: AgentActivityEvent[] = [];
const listeners = new Set<(event: AgentActivityEvent) => void>();
const clearListeners = new Set<() => void>();
let nextId = 0;

export function reportAgent(step: AgentStep): void {
  const event: AgentActivityEvent = { ...step, reason: step.reason?.slice(0, 300), id: ++nextId, at: Date.now() };
  history.push(event);
  if (history.length > MAX_HISTORY) history.shift();
  for (const listener of listeners) listener(event);
}

// The person's "clear log": forget the history, and tell every open page to do the same.
export function clearAgentActivity(): void {
  history.length = 0;
  for (const listener of clearListeners) listener();
}

export const recentAgentActivity = (): AgentActivityEvent[] => [...history];

export function onAgentActivity(listener: (event: AgentActivityEvent) => void, onClear?: () => void): () => void {
  listeners.add(listener);
  if (onClear) clearListeners.add(onClear);
  return () => {
    listeners.delete(listener);
    if (onClear) clearListeners.delete(onClear);
  };
}
