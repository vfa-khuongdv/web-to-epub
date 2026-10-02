import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StoredStory } from "../types";

/**
 * Error and guard paths of the audio export routes; the happy paths (zip, mix job, download)
 * run against a fake mixer in narration.test.ts.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "audio-exports-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const STORY_URL = "https://xtruyen.vn/truyen/audio-guards/";

describe("audio export routes (guards)", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let id: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { audioExportsRouter } = await import("./audioExports");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    id = store.storyId(STORY_URL);
    const app = express();
    app.use(express.json());
    app.use("/api", audioExportsRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}/api`;
  });

  beforeEach(async () => {
    const story: StoredStory = {
      id,
      storyUrl: STORY_URL,
      site: "xtruyen.vn",
      title: "Truyện",
      language: "vi",
      watching: false,
      newChapterCount: 0,
      createdAt: "2026-09-25T00:00:00.000Z",
      updatedAt: "2026-09-25T00:00:00.000Z",
      chapters: [{ order: 1, url: "u1", title: "Chương 1", status: "done", blocks: [{ type: "paragraph", text: "Một." }] }],
    };
    await stories.save(story);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  });

  const post = (url: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("409s a chapter's audio that has not been narrated, or a non-numeric order", async () => {
    const res = await fetch(`${base}/stories/${id}/chapters/1/audio`);
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/not been generated/);
    expect((await fetch(`${base}/stories/${id}/chapters/abc/audio`)).status).toBe(409);
    expect((await fetch(`${base}/stories/${id}/chapters/1/audio?download=1`)).status).toBe(409);
  });

  it("404s export-audio and export-audio-mix for an unknown story", async () => {
    expect((await post(`/stories/${"0".repeat(40)}/export-audio`)).status).toBe(404);
    expect((await post(`/stories/${"0".repeat(40)}/export-audio-mix`)).status).toBe(404);
  });

  it("400s an export when no chapter has current audio", async () => {
    const zip = await post(`/stories/${id}/export-audio`);
    expect(zip.status).toBe(400);
    expect((await zip.json()).message).toMatch(/No narrated chapters/);
    expect((await post(`/stories/${id}/export-audio`, { orders: [1, "x", 2.5] })).status).toBe(400);
    expect((await post(`/stories/${id}/export-audio-mix`)).status).toBe(400);
    expect((await post(`/stories/${id}/export-audio-mix`, { format: "zip" })).status).toBe(400);
  });

  it("401s a forged vault token on every story route", async () => {
    const headers = { "X-Vault-Token": "forged" };
    expect((await fetch(`${base}/stories/${id}/chapters/1/audio`, { headers })).status).toBe(401);
    expect((await post(`/stories/${id}/export-audio`, {}, headers)).status).toBe(401);
    expect((await post(`/stories/${id}/export-audio-mix`, {}, headers)).status).toBe(401);
  });

  it("404s an unknown mix job and an unknown audio export", async () => {
    expect((await fetch(`${base}/exports/audio-mix/nope`)).status).toBe(404);
    const res = await fetch(`${base}/exports/audio/nope`);
    expect(res.status).toBe(404);
    expect((await res.json()).message).toMatch(/expired/);
  });
});
