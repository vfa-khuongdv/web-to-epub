// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/api", () => ({ clearAgentActivity: vi.fn().mockResolvedValue(undefined) }));
import { clearAgentActivity } from "../lib/api";
import { setVaultToken } from "../vault/token";
import { useAgentActivity } from "./useAgentActivity";

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

const event = (id: number, kind: string) => ({ id, at: id, kind, host: "a.test", fn: "toc" });

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setVaultToken(null);
});

describe("useAgentActivity", () => {
  it("empties its lines on clear (asking the server too) and when another page clears", () => {
    const { result } = renderHook(() => useAgentActivity());
    const source = FakeEventSource.instances[0];
    act(() => source.emit({ type: "snapshot", events: [event(1, "ask"), event(2, "retry")] }));
    act(() => result.current.clear());
    expect(result.current.events).toEqual([]);
    expect(clearAgentActivity).toHaveBeenCalled();
    act(() => source.emit({ type: "event", event: event(3, "ask") }));
    expect(result.current.events).toHaveLength(1);
    act(() => source.emit({ type: "clear" }));
    expect(result.current.events).toEqual([]);
  });

  it("starts from the snapshot, appends steps once, and is busy until a step ends the work", () => {
    const { result } = renderHook(() => useAgentActivity());
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe("/api/agent-crawler/live");
    expect(result.current).toMatchObject({ events: [], busy: false });

    act(() => source.emit({ type: "snapshot", events: [event(1, "ask")] }));
    expect(result.current.busy).toBe(true);
    act(() => source.emit({ type: "event", event: event(2, "saved") }));
    act(() => source.emit({ type: "event", event: event(2, "saved") }));
    expect(result.current.events.map((e) => e.id)).toEqual([1, 2]);
    expect(result.current.busy).toBe(false);
  });

  it("ignores garbage, carries the private-mode token, and closes on unmount", () => {
    setVaultToken("t0k");
    const { result, unmount } = renderHook(() => useAgentActivity());
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe("/api/agent-crawler/live?vault=t0k");
    act(() => source.emit("not json"));
    expect(result.current.events).toEqual([]);
    unmount();
    expect(source.closed).toBe(true);
  });
});
