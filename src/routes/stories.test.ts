import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredStory } from "../types";

/**
 * The settings page promises that a newly added story starts from its defaults. That
 * promise is kept in the route, between the TOC adapter and the store, so it can only
 * be checked from the outside — hence a real Express server over a throwaway library.
 *
 * DATA_DIR is set before anything is imported: config/paths reads it at import time and
 * both the story store and the settings store open their database right there, so a
 * static import of any of them would attach this test to the developer's real library.
 */
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "stories-route-test-"));
process.env.DATA_DIR = DATA_DIR;

const STORY_URL = "https://xtruyen.vn/truyen/truyen-thu/";

// What the fake adapter reports, so a test can decide whether the chapter list names an
// author (the default only fills in the gap it leaves).
const toc = vi.hoisted(() => ({ author: undefined as string | undefined }));

vi.mock("../services/toc", () => ({
  getTocAdapter: (url: string) =>
    new URL(url).hostname === "xtruyen.vn"
      ? {
          domains: ["xtruyen.vn"],
          normalizeStoryUrl: (raw: string) => raw,
          fetchToc: async () => ({
            title: "Truyện thử",
            author: toc.author,
            chapters: [{ url: `${STORY_URL}chuong-1`, title: "Chương 1" }],
          }),
        }
      : undefined,
}));

describe("POST /stories applies the settings page's defaults", () => {
  let server: Server;
  let base: string;
  let settings: typeof import("../services/settingsStore").settingsStore;
  let stories: typeof import("../services/storyStore").storyStore;
  let id: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { storiesRouter } = await import("./stories");
    const store = await import("../services/storyStore");
    settings = (await import("../services/settingsStore")).settingsStore;
    stories = store.storyStore;
    id = store.storyId(STORY_URL);

    const app = express();
    app.use(express.json());
    app.use("/api", storiesRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  // Every story here has the same URL, so it has the same id: without this, one test's
  // story is the next one's "already in the library" and the defaults stop applying.
  beforeEach(async () => {
    const { DEFAULT_SETTINGS } = await import("../services/settingsStore");
    settings.update(DEFAULT_SETTINGS);
    toc.author = undefined;
    await stories.remove(id);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  async function addStory(): Promise<StoredStory> {
    const res = await fetch(`${base}/api/stories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: STORY_URL }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { story: StoredStory }).story;
  }

  it("fills a new story with the saved default language and author", async () => {
    settings.update({ defaultBookLanguage: "en", defaultAuthor: "Người dịch" });
    toc.author = undefined;

    const story = await addStory();
    expect(story.language).toBe("en");
    expect(story.author).toBe("Người dịch");

    // And it is what was written, not just what was answered.
    const saved = await stories.getOutline(story.id);
    expect(saved?.language).toBe("en");
    expect(saved?.author).toBe("Người dịch");
  });

  it("lets the chapter list's own author win over the default", async () => {
    settings.update({ defaultAuthor: "Người dịch" });
    toc.author = "Vong Ngữ";

    expect((await addStory()).author).toBe("Vong Ngữ");
  });

  it("leaves a story already in the library alone when the defaults change", async () => {
    const story = await addStory();
    await stories.updateMeta(story.id, { title: story.title, author: "Tác giả của tôi", language: "en" });

    // Adding the same URL again is the "reload the chapter list" path.
    settings.update({ defaultBookLanguage: "vi", defaultAuthor: "Người khác" });
    const again = await addStory();
    expect(again.author).toBe("Tác giả của tôi");
    expect(again.language).toBe("en");
  });

  it("uses the built-in defaults when the settings have never been touched", async () => {
    const story = await addStory();
    expect(story.language).toBe("vi");
    // An empty default means "leave it to the chapter list", not an empty author.
    expect(story.author).toBeUndefined();
  });
});
