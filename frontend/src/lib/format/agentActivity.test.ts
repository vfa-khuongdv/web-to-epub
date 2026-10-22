import { describe, expect, it } from "vitest";
import { AgentActivityEvent, describeAgentEvent, isAgentBusy } from "./agentActivity";

// Fills {params} like the app's t() does, so the sentences can be asserted as English.
const t = (key: string, params: Record<string, string | number> = {}) => key.replace(/\{(\w+)\}/g, (_, k) => String(params[k]));
const ev = (over: Partial<AgentActivityEvent>): AgentActivityEvent => ({ id: 1, at: 0, kind: "ask", host: "a.test", fn: "toc", ...over });

describe("describeAgentEvent", () => {
  it("words each step and flags the problems", () => {
    expect(describeAgentEvent(ev({ agent: "opencode", attempt: 2, of: 3 }), t)).toEqual({
      text: "Asking opencode to write the code that reads a.test's chapter list (try 2/3)",
      isError: false,
    });
    expect(describeAgentEvent(ev({ kind: "ask", fn: "chapter", agent: "Codex", attempt: 1, of: 3 }), t).text).toContain("chapter text");
    expect(describeAgentEvent(ev({ kind: "answer", agent: "opencode", ms: 12_340 }), t).text).toBe("opencode answered in 12.3s — trying the code on the page");
    expect(describeAgentEvent(ev({ kind: "retry", reason: "no chapters" }), t)).toEqual({ text: "That code did not work: no chapters", isError: true });
    expect(describeAgentEvent(ev({ kind: "saved", count: 74 }), t).text).toBe("Saved the chapter-list code for a.test — it found 74 chapters");
    expect(describeAgentEvent(ev({ kind: "saved", fn: "chapter", count: 9 }), t).text).toContain("9 blocks of text");
    expect(describeAgentEvent(ev({ kind: "reuse" }), t).isError).toBe(false);
    expect(describeAgentEvent(ev({ kind: "stale", reason: "boom" }), t)).toEqual({
      text: "The saved chapter-list code for a.test stopped working (boom). Rewrite it from the story's details",
      isError: true,
    });
    expect(describeAgentEvent(ev({ kind: "classify", fn: "url", agent: "opencode" }), t).text).toBe("Asking opencode whether a.test is the home page of a story");
    expect(describeAgentEvent(ev({ kind: "verdict", fn: "url", verdict: "story", reason: "lists chapters" }), t)).toEqual({ text: "It is a story page: lists chapters", isError: false });
    expect(describeAgentEvent(ev({ kind: "verdict", fn: "url", verdict: "chapter", reason: "one chapter" }), t)).toEqual({ text: "It is one page of text: one chapter", isError: false });
    expect(describeAgentEvent(ev({ kind: "verdict", fn: "url", verdict: undefined }), t).text).toBe("The answer could not be read — writing the code anyway");
    expect(describeAgentEvent(ev({ kind: "failed", reason: "x" }), t).isError).toBe(true);
    expect(describeAgentEvent(ev({ kind: "locked", reason: "https://a.test/c1" }), t).text).toBe("https://a.test/c1 asks for a login — the app does not bypass it");
  });
});

describe("isAgentBusy", () => {
  it("is busy while a step is waiting for the next one", () => {
    expect(isAgentBusy([])).toBe(false);
    for (const kind of ["classify", "ask", "answer", "retry"] as const) expect(isAgentBusy([ev({ kind })])).toBe(true);
    for (const kind of ["saved", "reuse", "stale", "failed", "locked"] as const) expect(isAgentBusy([ev({ kind })])).toBe(false);
    // Every verdict is followed by the code being written.
    expect(isAgentBusy([ev({ kind: "verdict", verdict: "story" })])).toBe(true);
    expect(isAgentBusy([ev({ kind: "verdict", verdict: "chapter" })])).toBe(true);
  });
});
