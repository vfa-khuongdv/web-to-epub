import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StoredStory } from "../types";
import { createStoryStore, storyId, type StoryStore } from "./storyStore";

function makeStory(overrides: Partial<StoredStory> = {}): StoredStory {
  return {
    id: storyId("https://example.com/truyen-a/"),
    storyUrl: "https://example.com/truyen-a/",
    site: "example.com",
    title: "Truyện A",
    chapters: [
      {
        order: 1,
        url: "https://example.com/truyen-a/chuong-1/",
        title: "Chương 1",
        status: "done",
        blocks: [{ type: "paragraph", text: "Nội dung chương 1" }],
      },
      { order: 2, url: "https://example.com/truyen-a/chuong-2/", title: "Chương 2", status: "pending" },
      {
        order: 3,
        url: "https://example.com/truyen-a/chuong-3/",
        title: "Chương 3",
        status: "error",
        error: "Trang bị xoá trắng",
      },
    ],
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    watching: false,
    newChapterCount: 0,
    ...overrides,
  };
}

describe("storyId", () => {
  it("stable and different between URLs", () => {
    expect(storyId("https://a.com/x/")).toBe(storyId("https://a.com/x/"));
    expect(storyId("https://a.com/x/")).not.toBe(storyId("https://a.com/y/"));
  });
});

describe("createStoryStore", () => {
  let dir: string;
  let store: StoryStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "story-store-"));
    store = createStoryStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates SQLite file in data directory", () => {
    expect(existsSync(path.join(dir, "stories.db"))).toBe(true);
  });

  it("save then get returns correct data (round-trip)", async () => {
    const story = makeStory();
    await store.save(story);
    expect(await store.get(story.id)).toEqual(story);
  });

  it("second save updates old chapter, no duplication", async () => {
    const story = makeStory();
    await store.save(story);
    story.chapters[1].status = "done";
    story.chapters[1].blocks = [{ type: "paragraph", text: "Nội dung chương 2" }];
    story.updatedAt = "2026-09-18T00:00:00.000Z";
    await store.save(story);

    const loaded = await store.get(story.id);
    expect(loaded?.chapters).toHaveLength(3);
    expect(loaded?.chapters[1].status).toBe("done");
    expect(loaded?.chapters[1].blocks).toEqual([{ type: "paragraph", text: "Nội dung chương 2" }]);
    expect(loaded?.updatedAt).toBe("2026-09-18T00:00:00.000Z");
  });

  it("getOutline returns all chapters but without content", async () => {
    const story = makeStory();
    await store.save(story);

    const outline = await store.getOutline(story.id);
    expect(outline?.title).toBe("Truyện A");
    expect(outline?.chapters.map((c) => c.order)).toEqual([1, 2, 3]);
    expect(outline?.chapters.every((c) => c.blocks === undefined)).toBe(true);
    // Status and error must still remain: chapter table depends on them.
    expect(outline?.chapters[2]).toMatchObject({ status: "error", error: "Trang bị xoá trắng" });
  });

  it("getChapter returns content of exactly one chapter", async () => {
    const story = makeStory();
    await store.save(story);

    expect(await store.getChapter(story.id, 1)).toEqual(story.chapters[0]);
    expect(await store.getChapter(story.id, 99)).toBeUndefined();
  });

  it("save syncs chapter list: chapters removed from TOC are deleted", async () => {
    const story = makeStory();
    await store.save(story);
    story.chapters = story.chapters.slice(0, 2);
    await store.save(story);

    const loaded = await store.get(story.id);
    expect(loaded?.chapters.map((c) => c.order)).toEqual([1, 2]);
  });

  it("list sorts by updatedAt descending with done/error/total counts", async () => {
    await store.save(makeStory({ updatedAt: "2026-09-17T00:00:00.000Z" }));
    await store.save(
      makeStory({ id: storyId("https://example.com/truyen-b/"), storyUrl: "https://example.com/truyen-b/", updatedAt: "2026-09-18T00:00:00.000Z" })
    );

    const stories = await store.list();
    expect(stories.map((s) => s.id)).toHaveLength(2);
    expect(stories[0].updatedAt).toBe("2026-09-18T00:00:00.000Z");
    expect(stories[1]).toMatchObject({
      chapterCount: 3,
      doneCount: 1,
      errorCount: 1,
      title: "Truyện A",
      site: "example.com",
    });
  });

  it("get/remove returns undefined/false when not found", async () => {
    expect(await store.get(storyId("https://example.com/khong-co/"))).toBeUndefined();
    expect(await store.remove(storyId("https://example.com/khong-co/"))).toBe(false);
  });

  it("get rejects id path traversal", async () => {
    expect(await store.get("../../x")).toBeUndefined();
  });

  it("remove rejects id path traversal", async () => {
    expect(await store.remove("../../x")).toBe(false);
  });

  it("save rejects id path traversal", async () => {
    await expect(store.save(makeStory({ id: "../../evil" }))).rejects.toThrow("Invalid story id");
  });

  it("remove deletes story with all chapters", async () => {
    const story = makeStory();
    await store.save(story);
    expect(await store.remove(story.id)).toBe(true);
    expect(await store.get(story.id)).toBeUndefined();

    const fresh = makeStory({ chapters: [{ order: 1, url: "https://example.com/truyen-a/chuong-1/", title: "Chương 1", status: "pending" }] });
    await store.save(fresh);
    expect((await store.get(story.id))?.chapters).toHaveLength(1);
  });

  it("saveChapter updates a chapter and bumps updatedAt", async () => {
    const story = makeStory({ updatedAt: "2020-01-01T00:00:00.000Z" });
    await store.save(story);

    const chapter = story.chapters[1];
    chapter.status = "done";
    chapter.blocks = [{ type: "heading", level: 1, text: "Chương 2" }];
    await store.saveChapter(story.id, chapter);

    const loaded = await store.get(story.id);
    expect(loaded?.chapters[1]).toEqual(chapter);
    expect(loaded?.chapters[0]).toEqual(story.chapters[0]);
    expect((loaded?.updatedAt ?? "").localeCompare("2020-01-01T00:00:00.000Z")).toBeGreaterThan(0);
  });

  it("saveChapter errors when story not found", async () => {
    const chapter = { order: 1, url: "https://example.com/x/1/", title: "Chương 1", status: "pending" as const };
    await expect(store.saveChapter(storyId("https://example.com/khong-co/"), chapter)).rejects.toThrow("Story not found");
  });

  it("saveChapter rejects id path traversal", async () => {
    const chapter = { order: 1, url: "https://example.com/x/1/", title: "Chương 1", status: "pending" as const };
    await expect(store.saveChapter("../../evil", chapter)).rejects.toThrow("Invalid story id");
  });

  it("updateMeta updates title/author/language/cover and keeps chapters unchanged", async () => {
    const story = makeStory();
    await store.save(story);

    const ok = await store.updateMeta(story.id, {
      title: "Truyện A (đã sửa)",
      author: "Tác giả mới",
      language: "en",
      coverUrl: `covers/${story.id}.jpg`,
    });

    expect(ok).toBe(true);
    const loaded = await store.get(story.id);
    expect(loaded).toMatchObject({
      title: "Truyện A (đã sửa)",
      author: "Tác giả mới",
      language: "en",
      coverUrl: `covers/${story.id}.jpg`,
    });
    expect(loaded?.chapters).toEqual(story.chapters);
  });

  it("updateMeta deletes author when no value", async () => {
    const story = makeStory({ author: "Tác giả cũ" });
    await store.save(story);

    await store.updateMeta(story.id, { title: story.title, language: "vi", coverUrl: undefined });

    expect((await store.get(story.id))?.author).toBeUndefined();
  });

  it("updateMeta returns false when story not found", async () => {
    expect(await store.updateMeta(storyId("https://example.com/khong-co/"), { title: "X" })).toBe(false);
  });

  it("updateMeta rejects id path traversal", async () => {
    expect(await store.updateMeta("../../evil", { title: "X" })).toBe(false);
  });

  it("setWatching enabled keeps check result, disabled clears new chapter count + error", async () => {
    const story = makeStory();
    await store.save(story);
    await store.setCheckResult(story.id, { newChapterCount: 3, checkedAt: "2026-09-18T00:00:00.000Z" });

    expect(await store.setWatching(story.id, true)).toBe(true);
    let loaded = await store.get(story.id);
    expect(loaded).toMatchObject({ watching: true, newChapterCount: 3, lastCheckedAt: "2026-09-18T00:00:00.000Z" });

    expect(await store.setWatching(story.id, false)).toBe(true);
    loaded = await store.get(story.id);
    expect(loaded).toMatchObject({ watching: false, newChapterCount: 0 });
    // Last check time is kept for display; new chapter count and error are cleared.
    expect(loaded?.lastCheckedAt).toBe("2026-09-18T00:00:00.000Z");
    expect(loaded?.checkError).toBeUndefined();
  });

  it("setWatching returns false when story not found", async () => {
    expect(await store.setWatching(storyId("https://example.com/khong-co/"), true)).toBe(false);
  });

  it("setCheckResult updates selectively, undefined keeps existing, null clears error", async () => {
    const story = makeStory();
    await store.save(story);

    await store.setCheckResult(story.id, { error: "mạng lỗi" });
    let loaded = await store.get(story.id);
    expect(loaded?.checkError).toBe("mạng lỗi");
    expect(loaded?.lastCheckedAt).toBeUndefined();

    await store.setCheckResult(story.id, { newChapterCount: 2, checkedAt: "2026-09-18T01:00:00.000Z", error: null });
    loaded = await store.get(story.id);
    expect(loaded).toMatchObject({ newChapterCount: 2, lastCheckedAt: "2026-09-18T01:00:00.000Z" });
    expect(loaded?.checkError).toBeUndefined();

    await store.setCheckResult(story.id, { error: "lỗi mới" });
    loaded = await store.get(story.id);
    expect(loaded).toMatchObject({
      newChapterCount: 2,
      lastCheckedAt: "2026-09-18T01:00:00.000Z",
      checkError: "lỗi mới",
    });
  });

  it("save does not overwrite watching info", async () => {
    const story = makeStory();
    await store.save(story);
    await store.setWatching(story.id, true);
    await store.setCheckResult(story.id, { newChapterCount: 5, checkedAt: "2026-09-18T00:00:00.000Z" });

    story.chapters.push({
      order: 4,
      url: "https://example.com/truyen-a/chuong-4/",
      title: "Chương 4",
      status: "pending",
    });
    story.watching = false;
    story.newChapterCount = 0;
    await store.save(story);

    const loaded = await store.get(story.id);
    expect(loaded).toMatchObject({ watching: true, newChapterCount: 5, lastCheckedAt: "2026-09-18T00:00:00.000Z" });
    expect(loaded?.chapters).toHaveLength(4);
  });

  it("list returns watching info", async () => {
    const story = makeStory();
    await store.save(story);
    await store.setWatching(story.id, true);
    await store.setCheckResult(story.id, { newChapterCount: 4 });

    const [summary] = await store.list();
    expect(summary).toMatchObject({ watching: true, newChapterCount: 4 });
    expect(summary.lastCheckedAt).toBeUndefined();
  });

  it("auto-adds watching column for DB created by old version", async () => {
    const legacyDir = await mkdtemp(path.join(os.tmpdir(), "story-store-legacy-watch-"));
    const legacyDb = new DatabaseSync(path.join(legacyDir, "stories.db"));
    legacyDb.exec(`
      CREATE TABLE stories (
        id TEXT PRIMARY KEY,
        story_url TEXT NOT NULL,
        site TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        cover_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE chapters (
        story_id TEXT NOT NULL,
        "order" INTEGER NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        blocks TEXT,
        PRIMARY KEY (story_id, "order")
      );
    `);
    legacyDb.close();

    const legacy = createStoryStore(legacyDir);
    const story = makeStory();
    await legacy.save(story);

    const loaded = await legacy.get(story.id);
    expect(loaded).toMatchObject({ watching: false, newChapterCount: 0 });
    expect(loaded?.lastCheckedAt).toBeUndefined();
    expect(loaded?.checkError).toBeUndefined();

    await rm(legacyDir, { recursive: true, force: true });
  });

  it("auto-adds language column for DB created by old version", async () => {
    const legacyDir = await mkdtemp(path.join(os.tmpdir(), "story-store-legacy-"));
    const legacyDb = new DatabaseSync(path.join(legacyDir, "stories.db"));
    legacyDb.exec(`
      CREATE TABLE stories (
        id TEXT PRIMARY KEY,
        story_url TEXT NOT NULL,
        site TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        cover_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE chapters (
        story_id TEXT NOT NULL,
        "order" INTEGER NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        blocks TEXT,
        PRIMARY KEY (story_id, "order")
      );
    `);
    legacyDb.close();

    const legacy = createStoryStore(legacyDir);
    const story = makeStory({ language: "vi" });
    await legacy.save(story);
    expect((await legacy.get(story.id))?.language).toBe("vi");

    await rm(legacyDir, { recursive: true, force: true });
  });
});
