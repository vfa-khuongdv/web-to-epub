import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoredStory } from "../types";
import { createStoryStore, storyId, summarize, type StoryStore } from "./storyStore";

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

describe("summarize", () => {
  it("đếm đúng done/error/total", () => {
    const summary = summarize(makeStory());
    expect(summary).toEqual({
      id: storyId("https://example.com/truyen-a/"),
      storyUrl: "https://example.com/truyen-a/",
      site: "example.com",
      title: "Truyện A",
      chapterCount: 3,
      doneCount: 1,
      errorCount: 1,
      updatedAt: "2026-09-17T00:00:00.000Z",
    });
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

  it("save rồi get trả về đúng dữ liệu (round-trip)", async () => {
    const story = makeStory();
    await store.save(story);
    expect(await store.get(story.id)).toEqual(story);
  });

  it("save lần sau ghi đè bản cũ", async () => {
    const story = makeStory();
    await store.save(story);
    story.chapters[1].status = "done";
    story.updatedAt = "2026-09-18T00:00:00.000Z";
    await store.save(story);

    const loaded = await store.get(story.id);
    expect(loaded?.chapters[1].status).toBe("done");
    expect(loaded?.updatedAt).toBe("2026-09-18T00:00:00.000Z");
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
  });

  it("list sắp xếp theo updatedAt giảm dần, bỏ qua file hỏng", async () => {
    await store.save(makeStory({ updatedAt: "2026-09-17T00:00:00.000Z" }));
    await store.save(
      makeStory({ id: storyId("https://example.com/truyen-b/"), storyUrl: "https://example.com/truyen-b/", updatedAt: "2026-09-18T00:00:00.000Z" })
    );
    await writeFile(path.join(dir, "broken.json"), "{ khong phai json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const stories = await store.list();
    expect(stories.map((s) => s.id)).toHaveLength(2);
    expect(stories[0].updatedAt).toBe("2026-09-18T00:00:00.000Z");
    warn.mockRestore();
  });

  it("get/remove trả undefined/false khi không tồn tại", async () => {
    expect(await store.get(storyId("https://example.com/khong-co/"))).toBeUndefined();
    expect(await store.remove(storyId("https://example.com/khong-co/"))).toBe(false);
  });

  it("remove xoá file", async () => {
    const story = makeStory();
    await store.save(story);
    expect(await store.remove(story.id)).toBe(true);
    expect(await store.get(story.id)).toBeUndefined();
  });
});
