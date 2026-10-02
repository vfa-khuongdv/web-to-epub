// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NarrationState } from "../types";
import { setVaultToken } from "../vault/token";

const api = vi.hoisted(() => ({
  fetchNarration: vi.fn(),
  startNarration: vi.fn(),
  stopNarration: vi.fn(),
}));
vi.mock("../lib/api", () => api);

import { useNarration } from "./useNarration";

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

const base: NarrationState = { narratable: true, chapters: { 1: "missing", 2: "ready" }, bytes: 0, running: null };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  setVaultToken(null);
  api.fetchNarration.mockReset().mockResolvedValue(base);
  api.startNarration.mockReset().mockResolvedValue(undefined);
  api.stopNarration.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setVaultToken(null);
});

async function setup(enabled = true) {
  const hook = renderHook(() => useNarration("s1", enabled));
  if (enabled) await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  return { hook, source: FakeEventSource.instances[0] };
}

describe("useNarration", () => {
  it("does nothing when disabled", () => {
    const { result } = renderHook(() => useNarration("s1", false));
    expect(api.fetchNarration).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.state).toBeNull();
  });

  it("loads state and opens the live channel (with vault token)", async () => {
    setVaultToken("t");
    const { hook, source } = await setup();
    expect(api.fetchNarration).toHaveBeenCalledWith("s1");
    expect(hook.result.current.state).toEqual(base);
    expect(source.url).toBe("/api/narration/live?vault=t");
  });

  it("reports a fetch failure as error", async () => {
    api.fetchNarration.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useNarration("s1", true));
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("refetches when the version changes", async () => {
    const hook = renderHook(({ v }) => useNarration("s1", true, v), { initialProps: { v: "a" } });
    await waitFor(() => expect(api.fetchNarration).toHaveBeenCalledTimes(1));
    hook.rerender({ v: "b" });
    await waitFor(() => expect(api.fetchNarration).toHaveBeenCalledTimes(2));
  });

  it("snapshot sets the running job for this story only", async () => {
    const { hook, source } = await setup();
    act(() =>
      source.emit({
        type: "snapshot",
        narrations: [
          { storyId: "other", done: 1, total: 5 },
          { storyId: "s1", done: 2, total: 7 },
        ],
      })
    );
    expect(hook.result.current.state?.running).toEqual({ storyId: "s1", done: 2, total: 7 });
    act(() => source.emit({ type: "snapshot", narrations: [] }));
    expect(hook.result.current.state?.running).toBeNull();
  });

  it("follows running, progress and chapter-done events", async () => {
    const { hook, source } = await setup();
    act(() => source.emit("garbage"));
    act(() => source.emit({ type: "narrate-running", storyId: "s1", done: 0, total: 3 }));
    expect(hook.result.current.state?.running).toEqual({ done: 0, total: 3 });

    act(() => source.emit({ type: "narrate-progress", storyId: "s1", order: 1, part: 2, parts: 4, done: 0, total: 3 }));
    expect(hook.result.current.state?.running).toMatchObject({ order: 1, part: 2, parts: 4 });

    act(() =>
      source.emit({ type: "narrate-chapter-done", storyId: "s1", order: 1, seconds: 5, skipped: false, done: 1, total: 3, etaMs: 99 })
    );
    expect(hook.result.current.state?.chapters[1]).toBe("ready");
    expect(hook.result.current.state?.running).toMatchObject({ done: 1, etaMs: 99 });
  });

  it("does not mark a skipped empty chapter ready", async () => {
    api.fetchNarration.mockResolvedValue({ ...base, chapters: { 1: "missing" } });
    const { hook, source } = await setup();
    act(() => source.emit({ type: "narrate-running", storyId: "s1", done: 0, total: 1 }));
    act(() =>
      source.emit({ type: "narrate-chapter-done", storyId: "s1", order: 3, seconds: 0, skipped: true, done: 1, total: 1 })
    );
    expect(hook.result.current.state?.chapters).toEqual({ 1: "missing" });
  });

  it("ignores events for other stories", async () => {
    const { hook, source } = await setup();
    act(() => source.emit({ type: "narrate-running", storyId: "other", done: 0, total: 3 }));
    expect(hook.result.current.state?.running).toBeNull();
  });

  it("idle yields an outcome with the last error, then refreshes", async () => {
    const { hook, source } = await setup();
    act(() => source.emit({ type: "narrate-running", storyId: "s1", done: 0, total: 2 }));
    act(() => source.emit({ type: "narrate-error", storyId: "s1", order: 1, message: "model failed", done: 1, total: 2 }));
    expect(hook.result.current.state?.running).toMatchObject({ done: 1 });
    act(() => source.emit({ type: "narrate-idle", storyId: "s1", done: 1, failed: 1, total: 2, cancelled: false }));
    expect(hook.result.current.outcome).toMatchObject({ done: 1, failed: 1, total: 2, cancelled: false, lastError: "model failed" });
    expect(hook.result.current.state?.running).toBeNull();
    await waitFor(() => expect(api.fetchNarration).toHaveBeenCalledTimes(2));

    act(() => hook.result.current.dismissOutcome());
    expect(hook.result.current.outcome).toBeNull();
  });

  it("a new run clears the previous outcome", async () => {
    const { hook, source } = await setup();
    act(() => source.emit({ type: "narrate-idle", storyId: "s1", done: 0, failed: 0, total: 0, cancelled: true }));
    expect(hook.result.current.outcome?.cancelled).toBe(true);
    act(() => source.emit({ type: "narrate-running", storyId: "s1", done: 0, total: 1 }));
    expect(hook.result.current.outcome).toBeNull();
  });

  it("start and stop call the API and surface failures", async () => {
    const { hook } = await setup();
    await act(() => hook.result.current.start([1, 2], { regenerate: true }));
    expect(api.startNarration).toHaveBeenCalledWith("s1", [1, 2], { regenerate: true });
    expect(hook.result.current.error).toBeNull();

    api.startNarration.mockRejectedValue(new Error("no engine"));
    await act(() => hook.result.current.start());
    expect(hook.result.current.error).toBe("no engine");

    api.stopNarration.mockRejectedValue(new Error("stop failed"));
    await act(() => hook.result.current.stop());
    expect(api.stopNarration).toHaveBeenCalledWith("s1");
    expect(hook.result.current.error).toBe("stop failed");
  });

  it("closes the channel on unmount", async () => {
    const { hook, source } = await setup();
    hook.unmount();
    expect(source.closed).toBe(true);
  });
});
