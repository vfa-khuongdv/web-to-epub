import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StoredStory } from "../types";

/** Highlight routes over a real Express server and a throwaway library. */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "highlights-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const STORY_URL = "https://www.fanfiction.net/s/14575449/1/Reluctant-Cultivator-in-Konoha";

describe("highlights routes", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let id: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { highlightsRouter } = await import("./highlights");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    id = store.storyId(STORY_URL);
    const app = express();
    app.use(express.json());
    app.use("/api", highlightsRouter);
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

  const send = (method: string, url: string, body?: unknown) =>
    fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const valid = { chapterOrder: 1, start: 0, end: 5, color: "yellow", text: "hello" };

  it("starts empty, then lists a created highlight", async () => {
    expect(await (await send("GET", `/stories/${id}/highlights`)).json()).toEqual({ highlights: [] });
    const created = await send("POST", `/stories/${id}/highlights`, valid);
    expect(created.status).toBe(201);
    const { highlight } = await created.json();
    expect(highlight).toMatchObject({ chapterOrder: 1, start: 0, end: 5, color: "yellow", text: "hello" });
    const list = (await (await send("GET", `/stories/${id}/highlights`)).json()).highlights;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(highlight.id);
  });

  it.each([
    [{ chapterOrder: 0 }, /chapter order/],
    [{ chapterOrder: 1.5 }, /chapter order/],
    [{ start: -1 }, /range/],
    [{ end: 0 }, /range/],
    [{ start: "0" }, /range/],
    [{ color: "neon" }, /colour/],
    [{ text: "   " }, /text is required/],
    [{ text: 5 }, /text is required/],
  ])("rejects an invalid highlight %j with 400", async (override, message) => {
    const res = await send("POST", `/stories/${id}/highlights`, { ...valid, ...override });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(message);
  });

  it("404s when the story does not exist", async () => {
    const res = await send("POST", `/stories/${"0".repeat(40)}/highlights`, valid);
    expect(res.status).toBe(404);
  });

  it("recolours and deletes a highlight, 404 for unknown ones", async () => {
    const { highlight } = await (await send("POST", `/stories/${id}/highlights`, valid)).json();

    expect((await send("PATCH", `/stories/${id}/highlights/${highlight.id}`, { color: "bogus" })).status).toBe(400);
    expect((await send("PATCH", `/stories/${id}/highlights/nope`, { color: "yellow" })).status).toBe(404);
    expect((await send("PATCH", `/stories/${id}/highlights/${highlight.id}`, { color: "blue" })).status).toBe(200);
    expect((await (await send("GET", `/stories/${id}/highlights`)).json()).highlights[0].color).toBe("blue");

    expect((await send("DELETE", `/stories/${id}/highlights/${highlight.id}`)).status).toBe(200);
    expect((await send("DELETE", `/stories/${id}/highlights/${highlight.id}`)).status).toBe(404);
    expect((await (await send("GET", `/stories/${id}/highlights`)).json()).highlights).toEqual([]);
  });

  it("answers 401 for a forged vault token", async () => {
    const res = await fetch(`${base}/stories/${id}/highlights`, { headers: { "X-Vault-Token": "forged" } });
    expect(res.status).toBe(401);
  });
});
