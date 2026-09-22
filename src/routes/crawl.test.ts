import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedChapter, StoredStory } from "../types";

/**
 * POST /stories/:id/crawl/stop — ends a running crawl. It's checked between chapters
 * (not mid-render), so a real Express server over a throwaway library, controlling when
 * the in-flight chapter "finishes" via a deferred promise, proves the loop actually stops
 * before starting the next chapter instead of just accepting the request.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "crawl-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const STORY_URL = "https://www.fanfiction.net/s/14575449/1/Reluctant-Cultivator-in-Konoha";

// Shared with the mock factory below (vi.mock is hoisted above imports).
const extract = vi.hoisted(() => {
  let releaseCall: (() => void) | null = null;
  let startedCall: (() => void) | null = null;
  return {
    calls: [] as string[],
    started: new Promise<void>((resolve) => {
      startedCall = resolve;
    }),
    release: new Promise<void>((resolve) => {
      releaseCall = resolve;
    }),
    resolveStarted: () => startedCall?.(),
    resolveRelease: () => releaseCall?.(),
    reset() {
      this.calls = [];
      this.started = new Promise<void>((resolve) => {
        startedCall = resolve;
      });
      this.release = new Promise<void>((resolve) => {
        releaseCall = resolve;
      });
    },
  };
});

vi.mock("../services/crawl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/crawl")>();
  return {
    ...actual,
    extractWithRetry: vi.fn(async (url: string): Promise<ExtractedChapter> => {
      extract.calls.push(url);
      extract.resolveStarted();
      await extract.release;
      return { sourceUrl: url, title: "T", blocks: [{ type: "paragraph", text: "ok" }] };
    }),
  };
});

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("POST /stories/:id/crawl/stop", () => {
  let server: Server;
  let base: string;
  let stories: typeof import("../services/storyStore").storyStore;
  let id: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { crawlRouter } = await import("./crawl");
    const store = await import("../services/storyStore");
    stories = store.storyStore;
    id = store.storyId(STORY_URL);

    const app = express();
    app.use(express.json());
    app.use("/api", crawlRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    extract.reset();
    await stories.remove(id);
    const story: StoredStory = {
      id,
      storyUrl: STORY_URL,
      site: "fanfiction.net",
      title: "Reluctant Cultivator in Konoha",
      watching: false,
      newChapterCount: 0,
      chapters: [1, 2, 3].map((order) => ({
        order,
        url: `https://www.fanfiction.net/s/14575449/${order}/Reluctant-Cultivator-in-Konoha`,
        title: `Chapter ${order}`,
        status: "pending" as const,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await stories.save(story);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("404s when nothing is crawling", async () => {
    const res = await fetch(`${base}/api/stories/${id}/crawl/stop`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("stops the loop before the next chapter starts, keeping already-finished work", async () => {
    const startRes = await fetch(`${base}/api/stories/${id}/crawl`, { method: "POST" });
    expect(startRes.status).toBe(202);

    // Wait for chapter 1's extractWithRetry call to be in flight before stopping.
    await extract.started;
    expect(extract.calls).toEqual([`https://www.fanfiction.net/s/14575449/1/Reluctant-Cultivator-in-Konoha`]);

    const stopRes = await fetch(`${base}/api/stories/${id}/crawl/stop`, { method: "POST" });
    expect(stopRes.status).toBe(200);

    // Let chapter 1 "finish" now that the abort was requested.
    extract.resolveRelease();

    // The loop must save chapter 1, then stop before ever calling chapter 2.
    await waitFor(async () => (await stories.getChapter(id, 1))?.status !== "pending");
    const chapter1 = await stories.getChapter(id, 1);
    expect(chapter1?.status).toBe("done");

    // Give the loop a moment to reach (and break at) the top of the next iteration.
    await new Promise((r) => setTimeout(r, 150));
    expect(extract.calls).toHaveLength(1);

    const chapter2 = await stories.getChapter(id, 2);
    const chapter3 = await stories.getChapter(id, 3);
    expect(chapter2?.status).toBe("pending");
    expect(chapter3?.status).toBe("pending");
  });
});
