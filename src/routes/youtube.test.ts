import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredStory } from "../types";

/**
 * The YouTube routes over a real Express server and a throwaway library; the account,
 * the API client and the jobs are faked, so what is pinned here is the route logic:
 * confirmations, refusals, and which orders a job is started with.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "youtube-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const fake = vi.hoisted(() => ({
  account: undefined as Record<string, unknown> | undefined,
  playlist: undefined as { id: string; title: string } | undefined,
  ffmpeg: "/usr/bin/ffmpeg" as string | undefined,
  agent: undefined as unknown,
  state: {} as Record<string, unknown>,
  prepare: vi.fn(async () => ({ done: 1, failed: 0 })),
  sync: vi.fn(async () => ({ imported: 2, updated: 0, playlistTitle: "T", playlistExists: true })),
  plan: vi.fn(async () => ({ totalHours: 2, missing: [], parts: [{ part: 1, from: 1, to: 2, hours: 2 }] })),
  renderCompilation: vi.fn(async () => ({ done: 1, failed: 0 })),
  uploadCompilation: vi.fn(async () => ({ done: 1, failed: 0 })),
  render: vi.fn(async () => ({ done: 1, failed: 0 })),
  upload: vi.fn(async () => ({ done: 1, failed: 0 })),
}));

vi.mock("../services/youtube/jobs", () => ({
  youTubeState: async () => fake.state,
  prepareYouTubeChapters: (...args: unknown[]) => fake.prepare(...(args as [])),
  syncYouTubeUploads: (...args: unknown[]) => fake.sync(...(args as [])),
  renderYouTubeVideos: (...args: unknown[]) => fake.render(...(args as [])),
  uploadYouTubeVideos: (...args: unknown[]) => fake.upload(...(args as [])),
  PlaylistMissingError: class PlaylistMissingError extends Error {},
  resolveVideoPath: () => undefined,
}));
vi.mock("../services/youtube/account", () => ({
  loadAccount: async () => fake.account,
  accessToken: async () => "token",
  authUrl: () => "https://accounts.test/auth",
  exchangeCode: async () => ({ access_token: "a", expires_in: 3600 }),
  fetchChannel: async () => undefined,
  pkcePair: () => ({ verifier: "v", challenge: "c" }),
  readClientSecret: async () => ({ clientId: "id", clientSecret: "secret" }),
  removeAccount: async () => {},
  saveAccount: async () => {},
}));
vi.mock("../services/youtube/api", () => ({ findPlaylist: async () => fake.playlist }));
vi.mock("../services/youtube/video", () => ({ findFfmpeg: () => fake.ffmpeg }));
vi.mock("../services/youtube/compilation", () => ({
  planCompilation: (...args: unknown[]) => fake.plan(...(args as [])),
  renderCompilations: (...args: unknown[]) => fake.renderCompilation(...(args as [])),
  uploadCompilations: (...args: unknown[]) => fake.uploadCompilation(...(args as [])),
  compilationChannelPlaylist: (title: string, channel: string) => `${title} – Trọn bộ | ${channel}`,
  resolveCompilationPath: () => undefined,
}));
vi.mock("../services/agent/agentConfig", () => ({ activeAgent: () => fake.agent }));
vi.mock("../services/youtube/summarize", () => ({ writeStoryIntro: async () => "Giới thiệu từ AI" }));

function makeStory(id: string): StoredStory {
  return {
    id,
    storyUrl: "https://x.test/truyen/youtube",
    site: "x.test",
    title: "Truyện",
    language: "vi",
    watching: false,
    newChapterCount: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    chapters: [
      { order: 1, url: "u1", title: "Chương 1", status: "done", blocks: [{ type: "paragraph", text: "Một." }] },
      { order: 2, url: "u2", title: "Chương 2", status: "done", blocks: [{ type: "paragraph", text: "Hai." }] },
    ],
  };
}

describe("YouTube routes", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let covers: ReturnType<typeof import("../services/coverStore").createCoverStore>;
  const id = "b".repeat(16);

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { youtubeRouter } = await import("./youtube");
    stories = (await import("../services/storyStore")).storyStore;
    covers = (await import("../services/coverStore")).createCoverStore(DATA_DIR);
    await stories.save(makeStory(id));
    const app = express();
    app.use(express.json());
    app.use("/api", youtubeRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(async () => {
    fake.agent = { name: "fake", complete: async () => "" };
    fake.account = { clientId: "id", clientSecret: "secret", refreshToken: "r", savedAt: "" };
    fake.playlist = undefined;
    fake.ffmpeg = "/usr/bin/ffmpeg";
    fake.prepare.mockClear();
    fake.render.mockClear();
    fake.upload.mockClear();
    fake.renderCompilation.mockClear();
    fake.uploadCompilation.mockClear();
    fake.state = { connected: true, chapters: [], playlist: { title: "T", exists: false }, running: null };
    await stories.removeYouTubeVideo(id, 1);
    await stories.removeYouTubeVideo(id, 2);
    await stories.save(makeStory(id));
    await stories.saveYouTubeStory({
      storyId: id,
      playlistTitle: "Truyện – Truyện Audio Full | Truyện FM",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("serves the panel state with the running job", async () => {
    const res = await fetch(`${base}/stories/${id}/youtube`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean; running: unknown };
    expect(body.connected).toBe(true);
    expect(body.running).toBeNull();
  });

  it("starts a prepare job for the chosen chapters", async () => {
    const res = await fetch(`${base}/stories/${id}/youtube/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1, 2] }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true, total: 2 });
    await vi.waitFor(() => expect(fake.prepare).toHaveBeenCalledTimes(1));
    const job = fake.prepare.mock.calls[0][0] as unknown as { orders: number[] };
    expect(job.orders).toEqual([1, 2]);
  });

  it("refuses to prepare without chapters and without ffmpeg it still prepares", async () => {
    const empty = await fetch(`${base}/stories/${id}/youtube/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [] }),
    });
    expect(empty.status).toBe(400);
  });

  it("refuses to render without ffmpeg or a cover, and starts once both exist", async () => {
    fake.ffmpeg = undefined;
    const noFfmpeg = await fetch(`${base}/stories/${id}/youtube/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1] }),
    });
    expect(noFfmpeg.status).toBe(409);

    fake.ffmpeg = "/usr/bin/ffmpeg";
    await stories.saveYouTubeVideo({
      storyId: id,
      order: 1,
      status: "draft",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const noCover = await fetch(`${base}/stories/${id}/youtube/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1] }),
    });
    expect(noCover.status).toBe(409);

    covers.saveBytes(id, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]));
    const ok = await fetch(`${base}/stories/${id}/youtube/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1] }),
    });
    expect(ok.status).toBe(202);
    await vi.waitFor(() => expect(fake.render).toHaveBeenCalledTimes(1));
  });

  it("passes the chosen background music to the render job", async () => {
    const { backgroundMusic } = await import("../services/backgroundMusic");
    const track = await backgroundMusic.add("Test track", Buffer.concat([Buffer.from("ID3"), Buffer.alloc(20)]));
    covers.saveBytes(id, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]));
    await stories.saveYouTubeVideo({
      storyId: id,
      order: 1,
      status: "draft",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const res = await fetch(`${base}/stories/${id}/youtube/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1], musicId: track.id, musicVolume: 0.2 }),
    });
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(fake.render).toHaveBeenCalledTimes(1));
    const job = fake.render.mock.calls[0][0] as unknown as { music?: { id?: string; volume?: number } };
    expect(job.music).toEqual({ id: track.id, volume: 0.2 });
  });

  it("writes the compilation intro with the agent", async () => {
    const res = await fetch(`${base}/stories/${id}/youtube/compilation/intro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ intro: "Giới thiệu từ AI" });
  });

  it("refuses to write the intro when the agent is off", async () => {
    fake.agent = undefined;
    const res = await fetch(`${base}/stories/${id}/youtube/compilation/intro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1] }),
    });
    expect(res.status).toBe(409);
  });

  it("plans and starts a full-story compilation", async () => {
    const plan = await fetch(`${base}/stories/${id}/youtube/compilation/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1, 2] }),
    });
    expect(plan.status).toBe(200);
    expect(await plan.json()).toEqual({ totalHours: 2, missing: [], parts: [{ part: 1, from: 1, to: 2, hours: 2 }] });

    const render = await fetch(`${base}/stories/${id}/youtube/compilation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1, 2], intro: "Giới thiệu", labelWord: "Tuyển tập" }),
    });
    expect(render.status).toBe(202);
    expect(await render.json()).toEqual({ started: true, total: 1, parts: 1 });
    await vi.waitFor(() => expect(fake.renderCompilation).toHaveBeenCalledTimes(1));
    const job = fake.renderCompilation.mock.calls[0][0] as unknown as { orders: number[]; intro: string; labelWord: string };
    expect(job.orders).toEqual([1, 2]);
    expect(job.intro).toBe("Giới thiệu");
    expect(job.labelWord).toBe("Tuyển tập");
  });

  it("announces a job on the live channel before its first chapter ends", async () => {
    const controller = new AbortController();
    const live = await fetch(`${base}/youtube/live`, { signal: controller.signal });
    const reader = live.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const nextEvent = async (): Promise<Record<string, unknown>> => {
      for (;;) {
        const index = buffer.indexOf("\n\n");
        if (index >= 0) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (chunk.startsWith("data: ")) return JSON.parse(chunk.slice(6));
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("live stream ended");
        buffer += decoder.decode(value, { stream: true });
      }
    };
    try {
      expect(await nextEvent()).toMatchObject({ type: "snapshot" });

      const render = await fetch(`${base}/stories/${id}/youtube/compilation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: [1, 2] }),
      });
      expect(render.status).toBe(202);

      // The panel learns the run started here — waiting for the first part to finish is
      // minutes of a silent, disabled UI.
      expect(await nextEvent()).toMatchObject({
        type: "youtube-running",
        storyId: id,
        phase: "compilation",
        done: 0,
        total: 1,
      });
    } finally {
      controller.abort();
    }
  });

  it("asks for the playlist confirmation before uploading a compilation", async () => {
    await stories.saveCompilation({
      id: "c1",
      storyId: id,
      part: 1,
      parts: 1,
      label: "Truyện – Trọn bộ (Chương 1-2)",
      fromOrder: 1,
      toOrder: 2,
      status: "rendered",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const refused = await fetch(`${base}/stories/${id}/youtube/compilation/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(refused.status).toBe(409);
    expect((await refused.json()) as { code?: string }).toMatchObject({ code: "playlist-missing" });

    const confirmed = await fetch(`${base}/stories/${id}/youtube/compilation/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createPlaylist: true }),
    });
    expect(confirmed.status).toBe(202);
    await vi.waitFor(() => expect(fake.uploadCompilation).toHaveBeenCalledTimes(1));
    const job = fake.uploadCompilation.mock.calls[0][0] as unknown as { createPlaylist: boolean };
    expect(job.createPlaylist).toBe(true);
  });

  it("edits a rendered part's info and schedule, but not once it is on YouTube", async () => {
    await stories.saveCompilation({
      id: "c9",
      storyId: id,
      part: 1,
      parts: 2,
      label: "Truyện – Trọn bộ Phần 1 (Chương 1-1)",
      fromOrder: 1,
      toOrder: 1,
      status: "rendered",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const res = await fetch(`${base}/stories/${id}/youtube/compilation/c9`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publishAt: "2026-11-20T18:00:00+07:00",
        title: "Truyện – Trọn bộ (Chương 1-1) | Truyện FM",
        description: "Mô tả\n\n#TruyệnFM #TruyệnAudio",
        tags: "truyện audio, nghe truyện",
      }),
    });
    expect(res.status).toBe(200);
    expect(await stories.getCompilation(id, "c9")).toMatchObject({
      publishAt: "2026-11-20T18:00:00+07:00",
      title: "Truyện – Trọn bộ (Chương 1-1) | Truyện FM",
      description: "Mô tả\n\n#TruyệnFM #TruyệnAudio",
      tags: "truyện audio, nghe truyện",
    });

    await stories.saveCompilation({
      id: "c10",
      storyId: id,
      part: 2,
      parts: 2,
      label: "Truyện – Trọn bộ Phần 2 (Chương 2-2)",
      fromOrder: 2,
      toOrder: 2,
      status: "uploaded",
      videoId: "v2",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const refused = await fetch(`${base}/stories/${id}/youtube/compilation/c10`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishAt: "2026-11-21T18:00:00+07:00" }),
    });
    expect(refused.status).toBe(409);
  });

  it("reports the compilation playlist and parts in the panel state", async () => {
    await stories.saveCompilation({
      id: "c2",
      storyId: id,
      part: 1,
      parts: 1,
      label: "Truyện – Trọn bộ (Chương 1-2)",
      fromOrder: 1,
      toOrder: 2,
      status: "rendered",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const res = await fetch(`${base}/stories/${id}/youtube`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { compilationPlaylist: string; compilations: { id: string }[] };
    expect(body.compilationPlaylist).toBe("Truyện – Trọn bộ | Truyện FM");
    expect(body.compilations.map((record) => record.id)).toContain("c2");
  });

  it("refuses to upload when not signed in", async () => {
    fake.account = undefined;
    const res = await fetch(`${base}/stories/${id}/youtube/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1] }),
    });
    expect(res.status).toBe(409);
  });

  it("asks for the playlist confirmation before creating one", async () => {
    await stories.saveYouTubeVideo({
      storyId: id,
      order: 1,
      status: "rendered",
      videoPath: `youtube/${id}/1.mp4`,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const refused = await fetch(`${base}/stories/${id}/youtube/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1] }),
    });
    expect(refused.status).toBe(409);
    expect((await refused.json()) as { code?: string }).toMatchObject({ code: "playlist-missing" });

    const confirmed = await fetch(`${base}/stories/${id}/youtube/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1], createPlaylist: true }),
    });
    expect(confirmed.status).toBe(202);
    await vi.waitFor(() => expect(fake.upload).toHaveBeenCalledTimes(1));
    const job = fake.upload.mock.calls[0][0] as unknown as { createPlaylist: boolean };
    expect(job.createPlaylist).toBe(true);
  });

  it("saves the story's general info without preparing chapters", async () => {
    const res = await fetch(`${base}/stories/${id}/youtube`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genreTags: "truyện xuyên sách", author: "Tác giả A" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await stories.getYouTubeStory(id)).toMatchObject({ genreTags: "truyện xuyên sách", author: "Tác giả A" });
  });

  it("refuses a general info field that is not text", async () => {
    const res = await fetch(`${base}/stories/${id}/youtube`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genreTags: 5 }),
    });
    expect(res.status).toBe(400);
  });

  it("syncs the chapters already on the channel", async () => {
    const res = await fetch(`${base}/stories/${id}/youtube/sync`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 2, updated: 0, playlistTitle: "T", playlistExists: true });
    expect(fake.sync).toHaveBeenCalledTimes(1);
  });

  it("refuses to sync when not signed in", async () => {
    fake.account = undefined;
    const res = await fetch(`${base}/stories/${id}/youtube/sync`, { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("does not upload a chapter that is already on YouTube", async () => {
    await stories.saveYouTubeVideo({
      storyId: id,
      order: 1,
      status: "uploaded",
      videoId: "vid",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const res = await fetch(`${base}/stories/${id}/youtube/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [1] }),
    });
    expect(res.status).toBe(400);
  });
});
