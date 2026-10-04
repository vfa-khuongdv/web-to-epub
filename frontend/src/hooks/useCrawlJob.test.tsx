// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setVaultToken } from "../vault/token";
import { advanceChapterStates, liveCounts, useCrawlJob } from "./useCrawlJob";

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

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  setVaultToken(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setVaultToken(null);
});

describe("advanceChapterStates / liveCounts", () => {
  it("sets one chapter state without mutating", () => {
    const before = { a: "running" as const };
    const after = advanceChapterStates(before, "b", "done");
    expect(after).toEqual({ a: "running", b: "done" });
    expect(before).toEqual({ a: "running" });
  });

  it("counts only pending chapters with a live outcome", () => {
    const chapters = [
      { url: "a", status: "pending" },
      { url: "b", status: "pending" },
      { url: "c", status: "done" },
      { url: "d", status: "pending" },
    ];
    expect(liveCounts(chapters, { a: "done", b: "error", c: "error", d: "running" })).toEqual({ done: 1, error: 1 });
  });
});

describe("useCrawlJob", () => {
  function setup() {
    const hook = renderHook(() => useCrawlJob());
    let unsub = () => {};
    act(() => {
      unsub = hook.result.current.subscribe();
    });
    return { hook, source: FakeEventSource.instances[0], unsub };
  }

  it("subscribes to the shared channel, with the vault token when set", () => {
    setVaultToken("tok en");
    const { source } = setup();
    expect(source.url).toBe("/api/stories/live?vault=tok%20en");
  });

  it("uses the plain URL without a token and closes on unsubscribe", () => {
    const { source, unsub } = setup();
    expect(source.url).toBe("/api/stories/live");
    unsub();
    expect(source.closed).toBe(true);
  });

  it("snapshot fills live crawls and ignores bad JSON", () => {
    const { hook, source } = setup();
    act(() => source.emit("not json"));
    expect(hook.result.current.live).toEqual({});
    act(() => source.emit({ type: "snapshot", crawls: [{ storyId: "s1", cursor: 2, total: 10, etaMs: 5 }] }));
    expect(hook.result.current.live).toEqual({ s1: { cursor: 2, total: 10, errors: 0, etaMs: 5 } });
  });

  it("attach seeds the job from a running crawl and resets otherwise", () => {
    const { hook, source } = setup();
    act(() => source.emit({ type: "snapshot", crawls: [{ storyId: "s1", cursor: 3, total: 6 }] }));
    act(() => {
      hook.result.current.attach("Story 1", "s1");
    });
    expect(hook.result.current.job).toMatchObject({ label: "Story 1", running: true, cursor: 3, total: 6, pct: 50 });
    act(() => {
      hook.result.current.attach("Story 2", "s2");
    });
    expect(hook.result.current.job).toMatchObject({ label: "Story 2", running: false, cursor: 0, total: 0, pct: 0 });
  });

  it("tracks progress, errors and chapter-done for the watched story", () => {
    const { hook, source } = setup();
    act(() => {
      hook.result.current.attach("S", "s1");
    });
    act(() =>
      source.emit({ type: "progress", storyId: "s1", index: 0, cursor: 1, total: 4, url: "u1", message: "ok" })
    );
    expect(hook.result.current.job).toMatchObject({
      running: true,
      cursor: 1,
      total: 4,
      pct: 25,
      chapters: { u1: "running" },
    });
    expect(hook.result.current.job.log[0]).toMatchObject({ text: "[1/4] u1 — ok", isError: false });
    expect(hook.result.current.live.s1).toMatchObject({ cursor: 1, total: 4, errors: 0 });

    act(() => source.emit({ type: "error", storyId: "s1", index: 1, cursor: 1, total: 4, url: "u2", message: "bad" }));
    expect(hook.result.current.job.errors).toBe(1);
    expect(hook.result.current.job.chapters.u2).toBe("error");
    expect(hook.result.current.job.log[1].isError).toBe(true);
    expect(hook.result.current.live.s1?.errors).toBe(1);

    act(() => source.emit({ type: "chapter-done", storyId: "s1", cursor: 2, total: 4, url: "u1", etaMs: 1000 }));
    expect(hook.result.current.job).toMatchObject({ cursor: 2, pct: 50, etaMs: 1000 });
    expect(hook.result.current.job.chapters.u1).toBe("done");

    act(() => source.emit({ type: "done", storyId: "s1" }));
    expect(hook.result.current.job).toMatchObject({ cursor: 4, pct: 100, etaMs: undefined });
  });

  it("idle clears the live entry and stops the watched job", () => {
    const { hook, source } = setup();
    act(() => {
      hook.result.current.attach("S", "s1");
    });
    act(() => source.emit({ type: "running", storyId: "s1", cursor: 1, total: 2 }));
    expect(hook.result.current.job.running).toBe(true);
    expect(hook.result.current.live.s1).toBeDefined();
    act(() => source.emit({ type: "idle", storyId: "s1" }));
    expect(hook.result.current.live.s1).toBeUndefined();
    expect(hook.result.current.job.running).toBe(false);
  });

  it("only updates live for stories that are not open, and ignores events without storyId", () => {
    const { hook, source } = setup();
    act(() => {
      hook.result.current.attach("S", "s1");
    });
    act(() => source.emit({ type: "progress", storyId: "other", index: 0, cursor: 1, total: 9, url: "x", message: "m" }));
    expect(hook.result.current.live.other).toMatchObject({ cursor: 1, total: 9 });
    expect(hook.result.current.job.log).toEqual([]);
    act(() => source.emit({ type: "progress", index: 0, total: 3 }));
    expect(Object.keys(hook.result.current.live)).toEqual(["other"]);
  });

  it("detach function stops watching; clearChapters drops the overlay", () => {
    const { hook, source } = setup();
    let detach = () => {};
    act(() => {
      detach = hook.result.current.attach("S", "s1");
    });
    act(() => source.emit({ type: "chapter-done", storyId: "s1", cursor: 1, total: 2, url: "u" }));
    expect(hook.result.current.job.chapters).toEqual({ u: "done" });
    act(() => hook.result.current.clearChapters());
    expect(hook.result.current.job.chapters).toEqual({});
    act(() => detach());
    act(() => source.emit({ type: "progress", storyId: "s1", index: 0, cursor: 1, total: 2, url: "z", message: "m" }));
    expect(hook.result.current.job.log).toEqual([]);
  });

  it("snapshot after reconnect stops a job whose crawl finished", () => {
    const { hook, source } = setup();
    act(() => {
      hook.result.current.attach("S", "s1");
    });
    act(() => source.emit({ type: "running", storyId: "s1", cursor: 1, total: 2 }));
    act(() => source.emit({ type: "snapshot", crawls: [] }));
    expect(hook.result.current.job.running).toBe(false);
  });

  it("caps the log at 500 lines", () => {
    const { hook, source } = setup();
    act(() => {
      hook.result.current.attach("S", "s1");
    });
    act(() => {
      for (let i = 0; i < 520; i++) {
        source.emit({ type: "progress", storyId: "s1", index: i, cursor: i, total: 600, url: `u${i}`, message: "m" });
      }
    });
    const log = hook.result.current.job.log;
    expect(log).toHaveLength(500);
    expect(log[499].text).toContain("u519");
  });

  it("pushNotice assigns increasing ids; dismissNotice removes one", () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.pushNotice({ kind: "session-saved" });
      hook.result.current.pushNotice({ kind: "export-done", fileCount: 2 });
    });
    const [a, b] = hook.result.current.notices;
    expect(b.id).toBeGreaterThan(a.id);
    act(() => hook.result.current.dismissNotice(a.id));
    expect(hook.result.current.notices).toEqual([b]);
  });
});
