// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubeState } from "../types";
import { setVaultToken } from "../vault/token";

const api = vi.hoisted(() => ({ fetchYouTubeStory: vi.fn() }));
vi.mock("../lib/api", () => api);

import { useYouTube } from "./useYouTube";

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

const base: YouTubeState = {
  connected: true,
  agentReady: true,
  cover: true,
  ffmpeg: true,
  config: { channel: "Truyện FM", scheduleTime: "18:00", genreTags: "truyện ngôn tình", musicVolume: 0.15 },
  story: { title: "Truyện" },
  playlist: { title: "Truyện – Truyện Audio Full | Truyện FM", exists: false },
  credits: { genreTags: "truyện ngôn tình" },
  chapters: [{ order: 1, title: "Chương 1", hasAudio: true, audioChanged: false }],
  compilationPlaylist: "Truyện – Trọn bộ | Truyện FM",
  compilations: [],
  running: null,
};

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  setVaultToken(null);
  api.fetchYouTubeStory.mockReset().mockResolvedValue(base);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setVaultToken(null);
});

describe("useYouTube", () => {
  it("loads the state and opens the job channel", async () => {
    setVaultToken("t");
    const { result } = renderHook(() => useYouTube("s1", true));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    expect(api.fetchYouTubeStory).toHaveBeenCalledWith("s1");
    expect(FakeEventSource.instances[0].url).toBe("/api/youtube/live?vault=t");
  });

  it("shows the run from the snapshot and refetches when a chapter ends", async () => {
    const { result } = renderHook(() => useYouTube("s1", true));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    const source = FakeEventSource.instances[0];
    source.emit({ type: "snapshot", jobs: [{ storyId: "s1", phase: "render", done: 1, total: 3 }] });
    await waitFor(() => expect(result.current.state?.running?.phase).toBe("render"));
    const calls = api.fetchYouTubeStory.mock.calls.length;
    source.emit({ type: "youtube-chapter-done", storyId: "s1", phase: "render", order: 2, state: "done", done: 2, total: 3 });
    await waitFor(() => expect(api.fetchYouTubeStory.mock.calls.length).toBeGreaterThan(calls));
  });

  it("shows a run that just started, before its first chapter ends", async () => {
    const { result } = renderHook(() => useYouTube("s1", true));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    FakeEventSource.instances[0].emit({ type: "youtube-running", storyId: "s1", phase: "compilation", done: 0, total: 2 });
    await waitFor(() => expect(result.current.state?.running).toEqual({ phase: "compilation", done: 0, total: 2 }));
  });

  it("takes a progress event as the start of a run when the start event was missed", async () => {
    const { result } = renderHook(() => useYouTube("s1", true));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    FakeEventSource.instances[0].emit({
      type: "youtube-progress",
      storyId: "s1",
      phase: "compilation",
      order: 1,
      done: 0,
      total: 2,
      percent: 25,
    });
    await waitFor(() => expect(result.current.state?.running?.percent).toBe(25));
  });

  it("keeps the quota message from an idle event", async () => {
    const { result } = renderHook(() => useYouTube("s1", true));
    await waitFor(() => expect(result.current.state).not.toBeNull());
    FakeEventSource.instances[0].emit({
      type: "youtube-idle",
      storyId: "s1",
      phase: "upload",
      done: 3,
      failed: 1,
      total: 4,
      cancelled: false,
      message: "quota",
    });
    await waitFor(() => expect(result.current.outcome?.message).toBe("quota"));
  });
});
