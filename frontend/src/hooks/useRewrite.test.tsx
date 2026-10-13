// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewriteState } from "../types";
import { setVaultToken } from "../vault/token";

const api = vi.hoisted(() => ({
  fetchRewriteState: vi.fn(),
  startRewrite: vi.fn(),
  stopRewrite: vi.fn(),
}));
vi.mock("../lib/api", () => api);

import { useRewrite } from "./useRewrite";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
}

const base: RewriteState = {
  narratable: true,
  ready: true,
  chapters: { 1: { rewritten: false }, 2: { rewritten: true } },
  remaining: 1,
  running: null,
};

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  setVaultToken(null);
  api.fetchRewriteState.mockReset().mockResolvedValue(base);
  api.startRewrite.mockReset().mockResolvedValue({ total: 1 });
  api.stopRewrite.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setVaultToken(null);
});

async function setup() {
  const hook = renderHook(() => useRewrite("s1", true));
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  return { hook, source: FakeEventSource.instances[0] };
}

describe("useRewrite", () => {
  it("loads state and opens the live channel with the vault token", async () => {
    setVaultToken("t");
    const { hook, source } = await setup();
    expect(api.fetchRewriteState).toHaveBeenCalledWith("s1");
    expect(hook.result.current.state).toEqual(base);
    expect(source.url).toBe("/api/rewrite/live?vault=t");
  });

  it("tracks a run and refetches on idle, telling the caller which orders were asked for", async () => {
    const finished = vi.fn();
    const hook = renderHook(() => useRewrite("s1", true, { onFinished: finished }));
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    const source = FakeEventSource.instances[0];
    await hook.result.current.start([1]);
    expect(api.startRewrite).toHaveBeenCalledWith("s1", [1]);
    source.emit({ type: "rewrite-running", storyId: "s1", done: 0, total: 1 });
    await waitFor(() => expect(hook.result.current.state?.running?.total).toBe(1));
    source.emit({ type: "rewrite-chapter-done", storyId: "s1", order: 1, skipped: false, done: 1, total: 1 });
    await waitFor(() => expect(hook.result.current.state?.chapters[1].rewritten).toBe(true));
    source.emit({ type: "rewrite-idle", storyId: "s1", done: 1, failed: 0, total: 1, cancelled: false });
    await waitFor(() => expect(hook.result.current.outcome?.done).toBe(1));
    expect(finished).toHaveBeenCalledWith([1]);
  });

  it("ignores events of other stories", async () => {
    const { hook, source } = await setup();
    source.emit({ type: "rewrite-running", storyId: "other", done: 0, total: 5 });
    expect(hook.result.current.state?.running).toBeNull();
  });

  it("reports a start failure", async () => {
    api.startRewrite.mockRejectedValue(new Error("agent off"));
    const { hook } = await setup();
    await hook.result.current.start();
    await waitFor(() => expect(hook.result.current.error).toBe("agent off"));
  });
});
