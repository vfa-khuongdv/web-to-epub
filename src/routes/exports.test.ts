import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StoredStory } from "../types";

/** EPUB export routes: validation, 404s, and the POST (NDJSON progress) then GET (download once) flow. */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "exports-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const STORY_URL = "https://www.fanfiction.net/s/14575449/1/Reluctant-Cultivator-in-Konoha";

describe("export routes", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let id: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { exportsRouter } = await import("./exports");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    id = store.storyId(STORY_URL);
    const app = express();
    app.use(express.json());
    app.use("/api", exportsRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}/api`;
  });

  beforeEach(async () => {
    await stories.remove(id);
    const story: StoredStory = {
      id,
      storyUrl: STORY_URL,
      site: "fanfiction.net",
      title: "Reluctant Cultivator",
      watching: false,
      newChapterCount: 0,
      chapters: [{ order: 1, url: STORY_URL, title: "Prologue", status: "done", blocks: [{ type: "paragraph", text: "hello world" }] }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await stories.save(story);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  });

  const post = (storyId: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/stories/${storyId}/export`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("404s an unknown or already-downloaded export id", async () => {
    const res = await fetch(`${base}/exports/${"0".repeat(36)}`);
    expect(res.status).toBe(404);
    expect((await res.json()).message).toMatch(/expired/);
  });

  it("requires metadata and a chapters array", async () => {
    expect((await post(id, {})).status).toBe(400);
    expect((await post(id, { metadata: { title: "x" } })).status).toBe(400);
    expect((await post(id, { chapters: [] })).status).toBe(400);
  });

  it("404s a story that does not exist and 401s a forged vault token", async () => {
    expect((await post("0".repeat(40), { metadata: { title: "x" }, chapters: [] })).status).toBe(404);
    expect((await post(id, { metadata: { title: "x" }, chapters: [] }, { "X-Vault-Token": "forged" })).status).toBe(401);
  });

  it("streams progress then a done event, and the file downloads exactly once", async () => {
    const res = await post(id, {
      metadata: { title: "My Book", author: "Me", language: "en" },
      chapters: [{ order: 1 }, { order: 99, contentHtml: "<p>edited, not stored</p>", title: "Extra" }, { order: 98 }],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/x-ndjson/);
    const events = (await res.text()).trim().split("\n").map((line) => JSON.parse(line));
    const done = events.find((e) => e.type === "done");
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(done.exports).toHaveLength(1);
    expect(done.exports[0].fileName).toBe("My Book.epub");

    const file = await fetch(`${base}/exports/${done.exports[0].exportId}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/epub+zip");
    expect(file.headers.get("content-disposition")).toMatch(/My%20Book\.epub|My Book\.epub/);
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");

    expect((await fetch(`${base}/exports/${done.exports[0].exportId}`)).status).toBe(404);
  });
});
