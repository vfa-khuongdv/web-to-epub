import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredStory } from "../types";

/**
 * The narration routes over a real Express server and a throwaway library; only the
 * Python side is faked. DATA_DIR is set before any import for the reason given in
 * stories.test.ts: the stores open their database at import time.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "narration-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const fake = vi.hoisted(() => ({
  installed: true,
  // Resolves a synth when set; lets a test hold a job open.
  gate: undefined as Promise<void> | undefined,
}));

vi.mock("../services/tts/runtime", () => ({
  ttsRuntime: {
    status: async () => ({ supported: true, state: fake.installed ? "installed" : "not-installed" }),
    withModel: async (_variant: string, fn: (worker: unknown) => Promise<unknown>) =>
      fn({
        synth: async (request: { parts: string[]; out: string; signal?: AbortSignal }) => {
          await fake.gate;
          if (request.signal?.aborted) {
            const { NarrationCancelled } = await import("../services/tts/workerClient");
            throw new NarrationCancelled();
          }
          await (await import("node:fs/promises")).writeFile(request.out, request.parts.join("|"));
          return { seconds: 3 };
        },
      }),
  },
}));

function makeStory(id: string, language: string): StoredStory {
  return {
    id,
    storyUrl: `https://xtruyen.vn/truyen/${language}/`,
    site: "xtruyen.vn",
    title: "Truyện",
    language,
    watching: false,
    newChapterCount: 0,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    chapters: [
      { order: 1, url: "u1", title: "Chương 1", status: "done", blocks: [{ type: "paragraph", text: "Một." }] },
      { order: 2, url: "u2", title: "Chương 2", status: "done", blocks: [{ type: "paragraph", text: "Hai." }] },
      { order: 3, url: "u3", title: "Chương 3", status: "pending" },
    ],
  };
}

describe("narration routes", () => {
  let server: Server;
  let base: string;
  let viId: string;
  let enId: string;
  let stories: typeof import("../services/storyStore").storyStore;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { narrationRouter } = await import("./narration");
    const { storiesRouter } = await import("./stories");
    const { audioExportsRouter } = await import("./audioExports");
    const { exportsRouter } = await import("./exports");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    viId = store.storyId("https://xtruyen.vn/truyen/vi/");
    enId = store.storyId("https://xtruyen.vn/truyen/en/");

    const app = express();
    app.use(express.json());
    app.use("/api", narrationRouter, audioExportsRouter, exportsRouter, storiesRouter);
    server = app.listen(0);
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api`;
  });

  beforeEach(async () => {
    fake.installed = true;
    fake.gate = undefined;
    await fs.rm(path.join(DATA_DIR, "audio"), { recursive: true, force: true });
    await stories.save(makeStory(viId, "vi"));
    await stories.save(makeStory(enId, "en"));
  });

  afterAll(async () => {
    server.close();
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  });

  const post = (url: string, body: unknown = {}) =>
    fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function waitIdle(id: string) {
    for (let i = 0; i < 100; i++) {
      const state = await (await fetch(`${base}/stories/${id}/narration`)).json();
      if (!state.running) return state;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("narration did not finish");
  }

  it("refuses unknown, non-Vietnamese, and not-installed cases", async () => {
    expect((await post(`/stories/${"0".repeat(40)}/narrate`)).status).toBe(404);

    const en = await post(`/stories/${enId}/narrate`);
    expect(en.status).toBe(400);
    expect((await en.json()).message).toMatch(/Vietnamese/);
    expect(await (await fetch(`${base}/stories/${enId}/narration`)).json()).toMatchObject({ narratable: false, chapters: {} });

    fake.installed = false;
    expect((await post(`/stories/${viId}/narrate`)).status).toBe(409);
  });

  it("narrates readable chapters in the background and reports them ready", async () => {
    expect(await (await fetch(`${base}/stories/${viId}/narration`)).json()).toMatchObject({
      narratable: true,
      chapters: { 1: "missing", 2: "missing" },
      running: null,
    });

    const res = await post(`/stories/${viId}/narrate`);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true, total: 2 });

    const state = await waitIdle(viId);
    expect(state.chapters).toEqual({ 1: "ready", 2: "ready" });
    expect(state.bytes).toBeGreaterThan(0);
  });

  it("narrates only the requested chapters", async () => {
    await post(`/stories/${viId}/narrate`, { orders: [2] });
    expect((await waitIdle(viId)).chapters).toEqual({ 1: "missing", 2: "ready" });
  });

  it("rejects a second job, blocks deleting the story, and stops on request", async () => {
    let open!: () => void;
    fake.gate = new Promise((r) => (open = r));
    expect((await post(`/stories/${viId}/narrate`)).status).toBe(202);

    expect((await post(`/stories/${viId}/narrate`)).status).toBe(409);
    expect((await fetch(`${base}/stories/${viId}`, { method: "DELETE" })).status).toBe(409);
    const running = (await (await fetch(`${base}/stories/${viId}/narration`)).json()).running;
    expect(running).toMatchObject({ done: 0, total: 2 });

    expect((await post(`/stories/${viId}/narrate/stop`)).status).toBe(200);
    open();
    expect((await waitIdle(viId)).chapters).toEqual({ 1: "missing", 2: "missing" });
    expect((await post(`/stories/${viId}/narrate/stop`)).status).toBe(404);
  });

  it("deleting a story removes its audio", async () => {
    await post(`/stories/${viId}/narrate`);
    await waitIdle(viId);
    await fs.access(path.join(DATA_DIR, "audio", viId));
    expect((await fetch(`${base}/stories/${viId}`, { method: "DELETE" })).status).toBe(200);
    await expect(fs.access(path.join(DATA_DIR, "audio", viId))).rejects.toThrow();
  });

  it("streams a snapshot and tagged events on the live channel", async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/narration/live`, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const events: { type: string; storyId?: string }[] = [];
    const reading = (async () => {
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (const match of buffer.matchAll(/^data: (.*)$/gm)) events.push(JSON.parse(match[1]));
        buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
        if (events.some((e) => e.type === "narrate-idle")) return;
      }
    })();

    await new Promise((r) => setTimeout(r, 20));
    await post(`/stories/${viId}/narrate`);
    await reading;
    controller.abort();

    expect(events[0]).toEqual({ type: "snapshot", narrations: [] });
    expect(events.slice(1).map((e) => e.type)).toEqual([
      "narrate-running",
      "narrate-chapter-done",
      "narrate-chapter-done",
      "narrate-idle",
    ]);
    expect(events.slice(1).every((e) => e.storyId === viId)).toBe(true);
    expect(events.at(-1)).toMatchObject({ done: 2, failed: 0, total: 2, cancelled: false });
  });

  it("serves one chapter's audio only while it matches the chapter", async () => {
    expect((await fetch(`${base}/stories/${viId}/chapters/1/audio`)).status).toBe(409);
    await post(`/stories/${viId}/narrate`);
    await waitIdle(viId);

    const res = await fetch(`${base}/stories/${viId}/chapters/1/audio`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(decodeURIComponent(res.headers.get("content-disposition") ?? "")).toContain("001 - Chương 1.mp3");
    expect(await res.text()).toBe("Chương 1|Một.");

    const edited = (await stories.getChapter(viId, 1))!;
    edited.blocks = [{ type: "paragraph", text: "Đã sửa." }];
    await stories.saveChapter(viId, edited);
    expect((await fetch(`${base}/stories/${viId}/chapters/1/audio`)).status).toBe(409);
  });

  it("zips the narrated chapters, lists the missing ones, and serves the zip once", async () => {
    expect((await post(`/stories/${viId}/export-audio`)).status).toBe(400);
    await post(`/stories/${viId}/narrate`, { orders: [2] });
    await waitIdle(viId);

    const res = await post(`/stories/${viId}/export-audio`);
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created).toMatchObject({ fileName: "Truyện (audio).zip", count: 1, missing: [1] });

    const zip = await fetch(`${base}/exports/audio/${created.exportId}`);
    expect(zip.status).toBe(200);
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(["002 - Chương 2.mp3"]);

    expect((await fetch(`${base}/exports/audio/${created.exportId}`)).status).toBe(404);
  });

  it("puts current narration into the EPUB only when asked", async () => {
    await post(`/stories/${viId}/narrate`, { orders: [1] });
    await waitIdle(viId);
    const { unzipSync } = await import("fflate");

    async function exportBook(includeNarration: boolean) {
      const res = await post(`/stories/${viId}/export`, {
        metadata: { title: "Truyện", author: "A", language: "vi" },
        chapters: [{ order: 1 }, { order: 2 }],
        includeNarration,
      });
      const lines = (await res.text()).trim().split("\n").map((line) => JSON.parse(line));
      const done = lines.find((line) => line.type === "done");
      expect(done, JSON.stringify(lines.at(-1))).toBeDefined();
      const book = await fetch(`${base}/exports/${done.exports[0].exportId}`);
      return unzipSync(new Uint8Array(await book.arrayBuffer()));
    }

    const plain = await exportBook(false);
    expect(Object.keys(plain).some((name) => name.endsWith(".mp3"))).toBe(false);

    const narrated = await exportBook(true);
    const mp3s = Object.keys(narrated).filter((name) => name.endsWith(".mp3"));
    expect(mp3s).toHaveLength(1);
    expect(Buffer.from(narrated[mp3s[0]]).toString()).toBe("Chương 1|Một.");
    const opf = Buffer.from(narrated["OEBPS/content.opf"]).toString();
    expect(opf).toContain('media-type="audio/mpeg"');
    const withAudio = Object.entries(narrated).filter(
      ([name, bytes]) => name.endsWith(".xhtml") && Buffer.from(bytes).toString().includes("<audio controls")
    );
    expect(withAudio).toHaveLength(1);
  }, 30_000);
});
