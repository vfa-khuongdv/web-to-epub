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
    ...overrides,
  };
}

describe("storyId", () => {
  it("stable và khác nhau giữa các URL", () => {
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

  it("tạo file SQLite trong thư mục dữ liệu", () => {
    expect(existsSync(path.join(dir, "stories.db"))).toBe(true);
  });

  it("save rồi get trả về đúng dữ liệu (round-trip)", async () => {
    const story = makeStory();
    await store.save(story);
    expect(await store.get(story.id)).toEqual(story);
  });

  it("save lần sau cập nhật chapter cũ, không nhân bản", async () => {
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

  it("save đồng bộ danh sách chapter: chapter bị bỏ khỏi TOC sẽ bị xoá", async () => {
    const story = makeStory();
    await store.save(story);
    story.chapters = story.chapters.slice(0, 2);
    await store.save(story);

    const loaded = await store.get(story.id);
    expect(loaded?.chapters.map((c) => c.order)).toEqual([1, 2]);
  });

  it("list sắp xếp theo updatedAt giảm dần kèm số đếm done/error/total", async () => {
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

  it("get/remove trả undefined/false khi không tồn tại", async () => {
    expect(await store.get(storyId("https://example.com/khong-co/"))).toBeUndefined();
    expect(await store.remove(storyId("https://example.com/khong-co/"))).toBe(false);
  });

  it("get từ chối id path traversal", async () => {
    expect(await store.get("../../x")).toBeUndefined();
  });

  it("remove từ chối id path traversal", async () => {
    expect(await store.remove("../../x")).toBe(false);
  });

  it("save từ chối id path traversal", async () => {
    await expect(store.save(makeStory({ id: "../../evil" }))).rejects.toThrow("Mã truyện không hợp lệ");
  });

  it("remove xoá truyện cùng toàn bộ chapter", async () => {
    const story = makeStory();
    await store.save(story);
    expect(await store.remove(story.id)).toBe(true);
    expect(await store.get(story.id)).toBeUndefined();

    const fresh = makeStory({ chapters: [{ order: 1, url: "https://example.com/truyen-a/chuong-1/", title: "Chương 1", status: "pending" }] });
    await store.save(fresh);
    expect((await store.get(story.id))?.chapters).toHaveLength(1);
  });

  it("saveChapter cập nhật một chapter và bump updatedAt", async () => {
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

  it("saveChapter báo lỗi khi truyện không tồn tại", async () => {
    const chapter = { order: 1, url: "https://example.com/x/1/", title: "Chương 1", status: "pending" as const };
    await expect(store.saveChapter(storyId("https://example.com/khong-co/"), chapter)).rejects.toThrow("Không tìm thấy truyện");
  });

  it("saveChapter từ chối id path traversal", async () => {
    const chapter = { order: 1, url: "https://example.com/x/1/", title: "Chương 1", status: "pending" as const };
    await expect(store.saveChapter("../../evil", chapter)).rejects.toThrow("Mã truyện không hợp lệ");
  });

  it("updateMeta cập nhật tên/tác giả/ngôn ngữ/bìa và giữ nguyên chương", async () => {
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

  it("updateMeta xoá tác giả khi không còn giá trị", async () => {
    const story = makeStory({ author: "Tác giả cũ" });
    await store.save(story);

    await store.updateMeta(story.id, { title: story.title, language: "vi", coverUrl: undefined });

    expect((await store.get(story.id))?.author).toBeUndefined();
  });

  it("updateMeta trả false khi không tìm thấy truyện", async () => {
    expect(await store.updateMeta(storyId("https://example.com/khong-co/"), { title: "X" })).toBe(false);
  });

  it("updateMeta từ chối id path traversal", async () => {
    expect(await store.updateMeta("../../evil", { title: "X" })).toBe(false);
  });

  it("tự thêm cột language cho DB tạo bởi bản cũ", async () => {
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
