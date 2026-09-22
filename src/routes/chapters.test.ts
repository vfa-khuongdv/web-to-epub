import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StoredChapter, StoredStory } from "../types";

/**
 * PATCH /stories/:id/chapters/:order/url — lets the user correct a chapter's source URL
 * (e.g. a stale TOC entry) without touching its content/status, so a real Express server
 * over a throwaway library, matching the pattern in stories.test.ts.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "chapters-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const STORY_URL = "https://www.fanfiction.net/s/14575449/1/Reluctant-Cultivator-in-Konoha";

describe("PATCH /stories/:id/chapters/:order/url", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let id: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { chaptersRouter } = await import("./chapters");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    id = store.storyId(STORY_URL);

    const app = express();
    app.use(express.json());
    app.use("/api", chaptersRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await stories.remove(id);
    const story: StoredStory = {
      id,
      storyUrl: STORY_URL,
      site: "fanfiction.net",
      title: "Reluctant Cultivator in Konoha",
      watching: false,
      newChapterCount: 0,
      chapters: [
        { order: 1, url: `${STORY_URL.replace("/1/", "/1/")}`, title: "Prologue", status: "error", error: "boom", errorKind: "other" },
        { order: 2, url: "https://www.fanfiction.net/s/14575449/2/Reluctant-Cultivator-in-Konoha", title: "Chapter 1", status: "done", blocks: [{ type: "paragraph", text: "hi" }] },
        { order: 3, url: "https://www.fanfiction.net/s/14575449/3/Reluctant-Cultivator-in-Konoha", title: "Wrong site title", status: "pending" },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await stories.save(story);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  async function patchUrl(order: number, body: unknown) {
    return fetch(`${base}/api/stories/${id}/chapters/${order}/url`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("updates the URL and leaves title/status/blocks alone", async () => {
    const res = await patchUrl(1, { url: "https://www.fanfiction.net/s/14575449/6/Reluctant-Cultivator-in-Konoha" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { chapter: StoredChapter };
    expect(data.chapter.url).toBe("https://www.fanfiction.net/s/14575449/6/Reluctant-Cultivator-in-Konoha");
    expect(data.chapter.title).toBe("Prologue");
    expect(data.chapter.status).toBe("error");
    expect(data.chapter.error).toBe("boom");

    const saved = await stories.getChapter(id, 1);
    expect(saved?.url).toBe("https://www.fanfiction.net/s/14575449/6/Reluctant-Cultivator-in-Konoha");
  });

  it("trims whitespace around the URL", async () => {
    const res = await patchUrl(2, { url: "  https://www.fanfiction.net/s/14575449/9/Reluctant-Cultivator-in-Konoha  " });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { chapter: StoredChapter };
    expect(data.chapter.url).toBe("https://www.fanfiction.net/s/14575449/9/Reluctant-Cultivator-in-Konoha");
  });

  it("rejects a missing/empty URL", async () => {
    const res = await patchUrl(1, { url: "   " });
    expect(res.status).toBe(400);
    const res2 = await patchUrl(1, {});
    expect(res2.status).toBe(400);
  });

  it("rejects a malformed URL", async () => {
    const res = await patchUrl(1, { url: "not a url" });
    expect(res.status).toBe(400);
  });

  it("404s for a chapter order that doesn't exist", async () => {
    const res = await patchUrl(99, { url: "https://www.fanfiction.net/s/14575449/9/x" });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /stories/:id/chapters/:order/title", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let id: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { chaptersRouter } = await import("./chapters");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    id = store.storyId(STORY_URL);

    const app = express();
    app.use(express.json());
    app.use("/api", chaptersRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await stories.remove(id);
    const story: StoredStory = {
      id,
      storyUrl: STORY_URL,
      site: "fanfiction.net",
      title: "Reluctant Cultivator in Konoha",
      watching: false,
      newChapterCount: 0,
      chapters: [
        {
          order: 1,
          url: "https://www.fanfiction.net/s/14575449/3/Reluctant-Cultivator-in-Konoha",
          title: "Wrong site title",
          status: "pending",
        },
        {
          order: 2,
          url: "https://www.fanfiction.net/s/14575449/2/Reluctant-Cultivator-in-Konoha",
          title: "Chapter 1",
          status: "done",
          blocks: [{ type: "paragraph", text: "hi" }],
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await stories.save(story);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  async function patchTitle(order: number, body: unknown) {
    return fetch(`${base}/api/stories/${id}/chapters/${order}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("renames a pending chapter (not yet crawled) and leaves status/url alone", async () => {
    const res = await patchTitle(1, { title: "The Real Chapter Name" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { chapter: StoredChapter };
    expect(data.chapter.title).toBe("The Real Chapter Name");
    expect(data.chapter.status).toBe("pending");
    expect(data.chapter.url).toBe("https://www.fanfiction.net/s/14575449/3/Reluctant-Cultivator-in-Konoha");

    const saved = await stories.getChapter(id, 1);
    expect(saved?.title).toBe("The Real Chapter Name");
    expect(saved?.status).toBe("pending");
  });

  it("also renames an already-crawled chapter without touching its content", async () => {
    const res = await patchTitle(2, { title: "Corrected Title" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { chapter: StoredChapter };
    expect(data.chapter.title).toBe("Corrected Title");
    expect(data.chapter.status).toBe("done");
    expect(data.chapter.blocks).toEqual([{ type: "paragraph", text: "hi" }]);
  });

  it("trims whitespace and rejects a missing/empty title", async () => {
    const trimmed = await patchTitle(1, { title: "  Spaced Title  " });
    expect((await trimmed.json() as { chapter: StoredChapter }).chapter.title).toBe("Spaced Title");

    const empty = await patchTitle(1, { title: "   " });
    expect(empty.status).toBe(400);
    const missing = await patchTitle(1, {});
    expect(missing.status).toBe(400);
  });

  it("404s for a chapter order that doesn't exist", async () => {
    const res = await patchTitle(99, { title: "x" });
    expect(res.status).toBe(404);
  });
});
