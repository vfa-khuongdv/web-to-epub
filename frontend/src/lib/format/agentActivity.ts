/** One step of the agent crawler, as src/services/agent/agentActivity.ts sends it on /api/agent-crawler/live. */
export interface AgentActivityEvent {
  id: number;
  at: number;
  kind: "classify" | "verdict" | "ask" | "answer" | "retry" | "saved" | "reuse" | "stale" | "failed" | "locked";
  host: string;
  fn: "url" | "toc" | "chapter" | "article" | "rewrite";
  agent?: string;
  attempt?: number;
  of?: number;
  ms?: number;
  count?: number;
  reason?: string;
  verdict?: string;
  // The chapter a rewrite step is about.
  order?: number;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

// The sentence for a step, in the reader's language, and whether it is a problem.
export function describeAgentEvent(e: AgentActivityEvent, t: Translate): { text: string; isError: boolean } {
  const toc = e.fn === "toc";
  const article = e.fn === "article";
  const rewrite = e.fn === "rewrite";
  const host = e.host;
  const reason = e.reason ?? "";
  switch (e.kind) {
    case "classify":
      return {
        text: t("Asking {agent} whether {host} is the home page of a story", { agent: e.agent ?? t("the agent"), host }),
        isError: false,
      };
    case "verdict": {
      if (e.verdict === "story") return { text: t("It is a story page: {reason}", { reason }), isError: false };
      if (e.verdict) return { text: t("It is one page of text: {reason}", { reason: reason || e.verdict }), isError: false };
      return { text: t("The answer could not be read — writing the code anyway"), isError: false };
    }
    case "ask": {
      const params = { agent: e.agent ?? t("the agent"), host, attempt: e.attempt ?? 1, of: e.of ?? 1 };
      return {
        text: rewrite
          ? t("Asking {agent} to rewrite chapter {order} of {host} for narration (try {attempt}/{of})", { ...params, order: e.order ?? 0 })
          : article
          ? t("Asking {agent} to write the code that reads {host}'s pages of text (try {attempt}/{of})", params)
          : toc
          ? t("Asking {agent} to write the code that reads {host}'s chapter list (try {attempt}/{of})", params)
          : t("Asking {agent} to write the code that reads {host}'s chapter text (try {attempt}/{of})", params),
        isError: false,
      };
    }
    case "answer":
      return {
        text: t("{agent} answered in {seconds}s — trying the code on the page", {
          agent: e.agent ?? t("The agent"),
          seconds: Math.round((e.ms ?? 0) / 100) / 10,
        }),
        isError: false,
      };
    case "retry":
      return {
        text: rewrite ? t("That rewrite did not pass ({reason}) — trying again", { reason }) : t("That code did not work: {reason}", { reason }),
        isError: true,
      };
    case "saved":
      return {
        text: rewrite
          ? t("Chapter {order} of {host} rewritten — {count} paragraphs", { host, order: e.order ?? 0, count: e.count ?? 0 })
          : article
          ? t("Saved the page-text code for {host} — it found {count} chapters", { host, count: e.count ?? 0 })
          : toc
          ? t("Saved the chapter-list code for {host} — it found {count} chapters", { host, count: e.count ?? 0 })
          : t("Saved the chapter-text code for {host} — it read {count} blocks of text", { host, count: e.count ?? 0 }),
        isError: false,
      };
    case "reuse":
      return {
        text: article
          ? t("Using the saved page-text code for {host}", { host })
          : toc
          ? t("Using the saved chapter-list code for {host}", { host })
          : t("Using the saved chapter-text code for {host}", { host }),
        isError: false,
      };
    case "stale":
      return {
        text: article
          ? t("The saved page-text code for {host} stopped working ({reason}) — asking the agent to write it again", { host, reason })
          : toc
          ? t("The saved chapter-list code for {host} stopped working ({reason}). Rewrite it from the story's details", { host, reason })
          : t("The saved chapter-text code for {host} stopped working ({reason}). Rewrite it from the story's details", { host, reason }),
        isError: true,
      };
    case "failed":
      return {
        text: rewrite
          ? t("The agent could not rewrite chapter {order} of {host}: {reason}", { host, order: e.order ?? 0, reason })
          : article
          ? t("The agent could not write the page-text code for {host}: {reason}", { host, reason })
          : toc
          ? t("The agent could not write the chapter-list code for {host}: {reason}", { host, reason })
          : t("The agent could not write the chapter-text code for {host}: {reason}", { host, reason }),
        isError: true,
      };
    case "locked":
      return { text: t("{url} asks for a login — the app does not bypass it", { url: reason || host }), isError: true };
  }
}

// The agent is working while the last step is one that a next step follows.
export const isAgentBusy = (events: AgentActivityEvent[]): boolean => {
  const last = events[events.length - 1];
  if (last?.kind === "verdict") return true;
  return last?.kind === "classify" || last?.kind === "ask" || last?.kind === "answer" || last?.kind === "retry";
};
