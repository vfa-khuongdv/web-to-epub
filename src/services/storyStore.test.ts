import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StoredStory } from "../types";
import { createStoryStore, HIGHLIGHT_COLORS, storyId, type StoryStore } from "./storyStore";

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

const LEGACY_SCHEMA = `
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
`;

async function makeLegacyDb(dir: string): Promise<void> {
  const db = new DatabaseSync(path.join(dir, "stories.db"));
  db.exec(LEGACY_SCHEMA);
  db.close();
}

function countRows(dir: string, table: "stories" | "chapters" | "highlights"): number {
  const db = new DatabaseSync(path.join(dir, "stories.db"));
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number };
  db.close();
  return Number(row.n);
}

describe("storyId", () => {
  it("stable and different between URLs", () => {
    expect(storyId("https://a.com/x/")).toBe(storyId("https://a.com/x/"));
    expect(storyId("https://a.com/x/")).not.toBe(storyId("https://a.com/y/"));
  });

  it("returns 16 lowercase hex characters", () => {
    expect(storyId("https://a.com/x/")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("createStoryStore", () => {
  let dir: string;
  let store: StoryStore;
  const legacyDirs: string[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "story-store-"));
    store = createStoryStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    for (const legacy of legacyDirs.splice(0)) {
      await rm(legacy, { recursive: true, force: true });
    }
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

  it("getChapter returns undefined for non-integer, zero or negative order", async () => {
    const story = makeStory();
    await store.save(story);

    expect(await store.getChapter(story.id, 1.5)).toBeUndefined();
    expect(await store.getChapter(story.id, Number.NaN)).toBeUndefined();
    expect(await store.getChapter(story.id, 0)).toBeUndefined();
    expect(await store.getChapter(story.id, -1)).toBeUndefined();
  });

  it("getChapter returns blocks undefined for a chapter saved without blocks", async () => {
    const story = makeStory();
    await store.save(story);

    const chapter = await store.getChapter(story.id, 2);
    expect(chapter).toEqual(story.chapters[1]);
    expect(chapter?.blocks).toBeUndefined();
  });

  it("getChapter/getOutline return undefined for invalid or unknown story id", async () => {
    expect(await store.getChapter("../../evil", 1)).toBeUndefined();
    expect(await store.getOutline("../../evil")).toBeUndefined();
    const missing = storyId("https://example.com/khong-co/");
    expect(await store.getChapter(missing, 1)).toBeUndefined();
    expect(await store.getOutline(missing)).toBeUndefined();
  });

  it("save syncs chapter list: chapters removed from TOC are deleted", async () => {
    const story = makeStory();
    await store.save(story);
    story.chapters = story.chapters.slice(0, 2);
    await store.save(story);

    const loaded = await store.get(story.id);
    expect(loaded?.chapters.map((c) => c.order)).toEqual([1, 2]);
  });

  it("save with an empty chapter list deletes all chapters and reports zero counts", async () => {
    const story = makeStory();
    await store.save(story);
    story.chapters = [];
    await store.save(story);

    expect((await store.get(story.id))?.chapters).toEqual([]);
    expect((await store.getOutline(story.id))?.chapters).toEqual([]);
    expect((await store.list())[0]).toMatchObject({ chapterCount: 0, doneCount: 0, errorCount: 0 });
  });

  it("save stores chapters sorted by order, not insertion order", async () => {
    const { chapters } = makeStory();
    const story = makeStory({ chapters: [chapters[2], chapters[0], chapters[1]] });
    await store.save(story);

    expect((await store.get(story.id))?.chapters.map((c) => c.order)).toEqual([1, 2, 3]);
    expect((await store.getOutline(story.id))?.chapters.map((c) => c.order)).toEqual([1, 2, 3]);
  });

  it("save round-trips an empty blocks array", async () => {
    const story = makeStory();
    story.chapters[0].blocks = [];
    await store.save(story);

    expect((await store.getChapter(story.id, 1))?.blocks).toEqual([]);
  });

  it("list sorts by updatedAt descending with done/error/total counts", async () => {
    await store.save(makeStory({ updatedAt: "2026-09-17T00:00:00.000Z" }));
    await store.save(
      makeStory({ id: storyId("https://example.com/truyen-b/"), storyUrl: "https://example.com/truyen-b/", updatedAt: "2026-09-18T00:00:00.000Z" })
    );

    const stories = await store.list();
    expect(stories).toHaveLength(2);
    expect(stories[0].updatedAt).toBe("2026-09-18T00:00:00.000Z");
    expect(stories[1]).toMatchObject({
      chapterCount: 3,
      doneCount: 1,
      errorCount: 1,
      title: "Truyện A",
      site: "example.com",
    });
  });

  it("list returns an empty array when the library has no stories", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("list pins equal-updatedAt tie-break and reports watch defaults", async () => {
    const a = makeStory({ updatedAt: "2026-09-17T00:00:00.000Z" });
    const b = makeStory({
      id: storyId("https://example.com/truyen-b/"),
      storyUrl: "https://example.com/truyen-b/",
      updatedAt: "2026-09-17T00:00:00.000Z",
    });
    // Saved in reverse id order: current SQLite behavior returns ties by id ascending.
    await store.save(b);
    await store.save(a);

    const stories = await store.list();
    expect(stories.map((s) => s.id)).toEqual([a.id, b.id]);
    expect(stories[0]).toMatchObject({ watching: false, newChapterCount: 0 });
    expect(stories[0].checkError).toBeUndefined();
    expect(stories[0].lastCheckedAt).toBeUndefined();
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
    await expect(store.save(makeStory({ id: "../../evil" }))).rejects.toThrow("Invalid story ID");
  });

  it("save rolls back the story upsert when a chapter write fails mid-transaction", async () => {
    const story = makeStory({
      id: storyId("https://example.com/rollback/"),
      storyUrl: "https://example.com/rollback/",
      chapters: [{ order: 1, url: null as unknown as string, title: "Chương 1", status: "done" }],
    });

    await expect(store.save(story)).rejects.toThrow();
    expect(await store.get(story.id)).toBeUndefined();
    expect(countRows(dir, "stories")).toBe(0);
    expect(countRows(dir, "chapters")).toBe(0);
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

  it("remove cascades to chapters and highlights on disk", async () => {
    const story = makeStory();
    await store.save(story);
    await store.addHighlight(story.id, { chapterOrder: 1, start: 0, end: 5, color: "yellow", text: "đoạn văn" });
    expect(countRows(dir, "chapters")).toBe(3);
    expect(countRows(dir, "highlights")).toBe(1);

    expect(await store.remove(story.id)).toBe(true);

    expect(countRows(dir, "stories")).toBe(0);
    expect(countRows(dir, "chapters")).toBe(0);
    expect(countRows(dir, "highlights")).toBe(0);
  });

  it("store methods reject ids outside the 16-char lowercase hex contract", async () => {
    const story = makeStory();
    await store.save(story);
    const malformed = [
      story.id.slice(0, 15),
      `${story.id}0`,
      story.id.toUpperCase(),
      story.id.replace(/[0-9a-f]/, "g"),
    ];

    for (const id of malformed) {
      expect(await store.get(id)).toBeUndefined();
      expect(await store.getOutline(id)).toBeUndefined();
      expect(await store.getChapter(id, 1)).toBeUndefined();
      expect(await store.listHighlights(id)).toEqual([]);
      expect(await store.updateMeta(id, { title: "X" })).toBe(false);
      expect(await store.setWatching(id, true)).toBe(false);
      expect(await store.setCheckResult(id, { newChapterCount: 1 })).toBe(false);
      expect(await store.setHighlightColor(id, "missing", "yellow")).toBe(false);
      expect(await store.removeHighlight(id, "missing")).toBe(false);
      expect(await store.remove(id)).toBe(false);
      await expect(store.save(makeStory({ id }))).rejects.toThrow("Invalid story ID");
      await expect(
        store.saveChapter(id, { order: 1, url: "https://example.com/x/1/", title: "Chương 1", status: "pending" })
      ).rejects.toThrow("Invalid story ID");
      await expect(
        store.addHighlight(id, { chapterOrder: 1, start: 0, end: 1, color: "yellow", text: "x" })
      ).rejects.toThrow("Invalid story ID");
    }

    expect(await store.get(story.id)).toEqual(story);
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
    await expect(store.saveChapter("../../evil", chapter)).rejects.toThrow("Invalid story ID");
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

  it("updateMeta deletes previously-set language and coverUrl when omitted", async () => {
    const story = makeStory({ language: "vi", coverUrl: "covers/truyen-a.jpg" });
    await store.save(story);
    expect(await store.get(story.id)).toMatchObject({ language: "vi", coverUrl: "covers/truyen-a.jpg" });

    await store.updateMeta(story.id, { title: story.title });

    const loaded = await store.get(story.id);
    expect(loaded?.language).toBeUndefined();
    expect(loaded?.coverUrl).toBeUndefined();
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
    await store.setCheckResult(story.id, {
      newChapterCount: 3,
      checkedAt: "2026-09-18T00:00:00.000Z",
      error: "mạng lỗi",
    });

    expect(await store.setWatching(story.id, true)).toBe(true);
    let loaded = await store.get(story.id);
    expect(loaded).toMatchObject({
      watching: true,
      newChapterCount: 3,
      lastCheckedAt: "2026-09-18T00:00:00.000Z",
      checkError: "mạng lỗi",
    });

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

  it("setCheckResult returns false for malformed or unknown id", async () => {
    expect(await store.setCheckResult("../../evil", { newChapterCount: 1 })).toBe(false);
    expect(await store.setCheckResult(storyId("https://example.com/khong-co/"), { newChapterCount: 1 })).toBe(false);
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

  it("setCheckResult keeps the existing error when error is omitted", async () => {
    const story = makeStory();
    await store.save(story);
    await store.setCheckResult(story.id, { error: "lỗi cũ" });
    expect((await store.get(story.id))?.checkError).toBe("lỗi cũ");

    await store.setCheckResult(story.id, { newChapterCount: 1 });

    expect((await store.get(story.id))?.checkError).toBe("lỗi cũ");
    expect((await store.list())[0].checkError).toBe("lỗi cũ");
  });

  it("setCheckResult stores an explicit 0 and a very large newChapterCount", async () => {
    const story = makeStory();
    await store.save(story);

    await store.setCheckResult(story.id, { newChapterCount: 7 });
    expect((await store.get(story.id))?.newChapterCount).toBe(7);

    await store.setCheckResult(story.id, { newChapterCount: 0 });
    expect((await store.get(story.id))?.newChapterCount).toBe(0);
    expect((await store.list())[0].newChapterCount).toBe(0);

    await store.setCheckResult(story.id, { newChapterCount: 10_000 });
    expect((await store.get(story.id))?.newChapterCount).toBe(10_000);
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

  it("addHighlight generates id/createdAt and listHighlights round-trips", async () => {
    const story = makeStory();
    await store.save(story);

    const added = await store.addHighlight(story.id, {
      chapterOrder: 1,
      start: 10,
      end: 25,
      color: "yellow",
      text: "một đoạn văn",
    });

    expect(added.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(added.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await store.listHighlights(story.id)).toEqual([added]);
  });

  it("addHighlight accepts every HIGHLIGHT_COLORS value", async () => {
    const story = makeStory();
    await store.save(story);
    for (const [index, color] of HIGHLIGHT_COLORS.entries()) {
      await store.addHighlight(story.id, { chapterOrder: 1, start: index, end: index + 1, color, text: color });
    }

    expect((await store.listHighlights(story.id)).map((h) => h.color)).toEqual([...HIGHLIGHT_COLORS]);
  });

  it("listHighlights orders by chapter order then start", async () => {
    const story = makeStory();
    await store.save(story);
    const specs = [
      { chapterOrder: 2, start: 5 },
      { chapterOrder: 1, start: 30 },
      { chapterOrder: 1, start: 5 },
      { chapterOrder: 2, start: 1 },
    ];
    for (const spec of specs) {
      await store.addHighlight(story.id, {
        ...spec,
        end: spec.start + 4,
        color: "blue",
        text: `c${spec.chapterOrder}-${spec.start}`,
      });
    }

    expect((await store.listHighlights(story.id)).map((h) => [h.chapterOrder, h.start])).toEqual([
      [1, 5],
      [1, 30],
      [2, 1],
      [2, 5],
    ]);
  });

  it("highlights are scoped to their own story", async () => {
    const storyA = makeStory();
    const storyB = makeStory({
      id: storyId("https://example.com/truyen-b/"),
      storyUrl: "https://example.com/truyen-b/",
    });
    await store.save(storyA);
    await store.save(storyB);
    const highlight = await store.addHighlight(storyA.id, {
      chapterOrder: 1,
      start: 0,
      end: 5,
      color: "green",
      text: "A",
    });

    expect(await store.listHighlights(storyB.id)).toEqual([]);
    expect(await store.setHighlightColor(storyB.id, highlight.id, "pink")).toBe(false);
    expect(await store.removeHighlight(storyB.id, highlight.id)).toBe(false);
    expect(await store.listHighlights(storyA.id)).toEqual([highlight]);
  });

  it("setHighlightColor updates the color and reports unknown ids", async () => {
    const story = makeStory();
    await store.save(story);
    const highlight = await store.addHighlight(story.id, {
      chapterOrder: 1,
      start: 0,
      end: 5,
      color: "yellow",
      text: "x",
    });

    expect(await store.setHighlightColor(story.id, highlight.id, "pink")).toBe(true);
    expect((await store.listHighlights(story.id))[0].color).toBe("pink");
    expect(await store.setHighlightColor(story.id, "missing-id", "pink")).toBe(false);
  });

  it("removeHighlight deletes only the given highlight", async () => {
    const story = makeStory();
    await store.save(story);
    const first = await store.addHighlight(story.id, {
      chapterOrder: 1,
      start: 0,
      end: 5,
      color: "yellow",
      text: "1",
    });
    const second = await store.addHighlight(story.id, {
      chapterOrder: 1,
      start: 6,
      end: 9,
      color: "blue",
      text: "2",
    });

    expect(await store.removeHighlight(story.id, first.id)).toBe(true);
    expect(await store.listHighlights(story.id)).toEqual([second]);
    expect(await store.removeHighlight(story.id, first.id)).toBe(false);
  });

  it("auto-adds watching column for DB created by old version", async () => {
    const legacyDir = await mkdtemp(path.join(os.tmpdir(), "story-store-legacy-watch-"));
    legacyDirs.push(legacyDir);
    await makeLegacyDb(legacyDir);

    const legacy = createStoryStore(legacyDir);
    const story = makeStory();
    await legacy.save(story);

    const loaded = await legacy.get(story.id);
    expect(loaded).toMatchObject({ watching: false, newChapterCount: 0 });
    expect(loaded?.lastCheckedAt).toBeUndefined();
    expect(loaded?.checkError).toBeUndefined();
  });

  it("auto-adds language column for DB created by old version", async () => {
    const legacyDir = await mkdtemp(path.join(os.tmpdir(), "story-store-legacy-"));
    legacyDirs.push(legacyDir);
    await makeLegacyDb(legacyDir);

    const legacy = createStoryStore(legacyDir);
    const story = makeStory({ language: "vi" });
    await legacy.save(story);
    expect((await legacy.get(story.id))?.language).toBe("vi");
  });
});
