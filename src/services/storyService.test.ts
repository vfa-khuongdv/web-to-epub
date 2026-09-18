import { describe, expect, it } from "vitest";
import { StoredStory } from "../types";
import { TocResult } from "./toc/types";
import { chaptersToCrawl, countNewChapters, mergeStory, pickChapterTitle, toExtractedChapter } from "./storyService";

const toc: TocResult = {
  title: "Truyện A",
  author: "Tác giả",
  coverUrl: "https://example.com/cover.jpg",
  chapters: [
    { url: "https://example.com/a/chuong-1/", title: "Chương 1" },
    { url: "https://example.com/a/chuong-2/", title: "Chương 2" },
    { url: "https://example.com/a/chuong-3/", title: "Chương 3" },
  ],
};

function existingStory(overrides: Partial<StoredStory> = {}): StoredStory {
  return {
    id: "abc",
    storyUrl: "https://example.com/a/",
    site: "example.com",
    title: "Truyện A",
    chapters: [
      { order: 1, url: "https://example.com/a/chuong-1/", title: "Chương 1 (sửa)", status: "done", blocks: [{ type: "paragraph", text: "x" }] },
      { order: 2, url: "https://example.com/a/chuong-2/", title: "Chương 2", status: "error", error: "timeout" },
    ],
    watching: false,
    newChapterCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeStory", () => {
  it("creates new when not existing: all chapters pending, keeps new createdAt", () => {
    const merged = mergeStory({ site: "example.com", storyUrl: "https://example.com/a/", toc, now: "2026-09-17T00:00:00.000Z" });
    expect(merged.chapters.map((c) => c.status)).toEqual(["pending", "pending", "pending"]);
    expect(merged.chapters.map((c) => c.order)).toEqual([1, 2, 3]);
    expect(merged.createdAt).toBe("2026-09-17T00:00:00.000Z");
    expect(merged.author).toBe("Tác giả");
  });

  it("keeps status/blocks/error/title of old chapters by URL, adds new chapters as pending", () => {
    const merged = mergeStory({ existing: existingStory(), site: "example.com", storyUrl: "https://example.com/a/", toc });
    expect(merged.chapters[0]).toMatchObject({ status: "done", title: "Chương 1 (sửa)" });
    expect(merged.chapters[1]).toMatchObject({ status: "error", error: "timeout" });
    expect(merged.chapters[2]).toMatchObject({ status: "pending" });
    expect(merged.createdAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("keeps title/author/language user saved when reloading TOC", () => {
    const merged = mergeStory({
      existing: existingStory({ title: "Tên người dùng sửa", author: "Tác giả sửa", language: "en" }),
      site: "example.com",
      storyUrl: "https://example.com/a/",
      toc,
    });
    expect(merged.title).toBe("Tên người dùng sửa");
    expect(merged.author).toBe("Tác giả sửa");
    expect(merged.language).toBe("en");
  });

  it("carries watching flag and check result from old story", () => {
    const merged = mergeStory({
      existing: existingStory({
        watching: true,
        newChapterCount: 3,
        lastCheckedAt: "2026-09-18T00:00:00.000Z",
        checkError: "mạng lỗi",
      }),
      site: "example.com",
      storyUrl: "https://example.com/a/",
      toc,
    });
    expect(merged.watching).toBe(true);
    expect(merged.newChapterCount).toBe(3);
    expect(merged.lastCheckedAt).toBe("2026-09-18T00:00:00.000Z");
    expect(merged.checkError).toBe("mạng lỗi");
  });

  it("new story defaults to not watching", () => {
    const merged = mergeStory({ site: "example.com", storyUrl: "https://example.com/a/", toc });
    expect(merged.watching).toBe(false);
    expect(merged.newChapterCount).toBe(0);
    expect(merged.lastCheckedAt).toBeUndefined();
    expect(merged.checkError).toBeUndefined();
  });
});

describe("countNewChapters", () => {
  const stored = [{ url: "https://example.com/a/chuong-1/" }, { url: "https://example.com/a/chuong-2/" }];

  it("counts URLs in TOC that library doesn't have", () => {
    expect(
      countNewChapters(stored, [
        { url: "https://example.com/a/chuong-1/", title: "Chương 1" },
        { url: "https://example.com/a/chuong-2/", title: "Chương 2" },
        { url: "https://example.com/a/chuong-3/", title: "Chương 3" },
        { url: "https://example.com/a/chuong-4/", title: "Chương 4" },
      ])
    ).toBe(2);
  });

  it("returns 0 when TOC fully matches, shorter, or empty", () => {
    expect(countNewChapters(stored, stored.map((c) => ({ ...c, title: "x" })))).toBe(0);
    expect(countNewChapters(stored, [{ url: "https://example.com/a/chuong-1/", title: "Chương 1" }])).toBe(0);
    expect(countNewChapters(stored, [])).toBe(0);
  });
});

describe("chaptersToCrawl", () => {
  it("by default only not-done chapters (pending + error), keeps order", () => {
    const story = existingStory();
    story.chapters.push({ order: 3, url: "https://example.com/a/chuong-3/", title: "Chương 3", status: "pending" });
    expect(chaptersToCrawl(story).map((c) => c.order)).toEqual([2, 3]);
  });

  it("if orders given, returns those orders including done chapters", () => {
    const story = existingStory();
    expect(chaptersToCrawl(story, [1]).map((c) => c.order)).toEqual([1]);
  });

  it("skips non-existent order", () => {
    expect(chaptersToCrawl(existingStory(), [99])).toEqual([]);
  });
});

describe("toExtractedChapter", () => {
  it("done chapter: returns blocks; error chapter: returns error", () => {
    expect(toExtractedChapter({ order: 1, url: "u", title: "t", status: "done", blocks: [] })).toEqual({
      sourceUrl: "u",
      title: "t",
      blocks: [],
    });
    const failed = toExtractedChapter({ order: 2, url: "u2", title: "t2", status: "error", error: "lỗi" });
    expect(failed.error).toBe("lỗi");
  });
});

describe("pickChapterTitle", () => {
  const url = "https://xtruyen.vn/truyen/kiem-lai/quyen-1-chuong-2/";

  it("takes page title when it's fuller than TOC title", () => {
    expect(pickChapterTitle("Quyển 1 Chương 2", "Quyển 1 Chương 2 : Mở cửa", url)).toBe("Quyển 1 Chương 2 : Mở cửa");
    expect(pickChapterTitle("Chương 1", "Chương 1: Sơn biên tiểu thôn", url)).toBe("Chương 1: Sơn biên tiểu thôn");
  });

  it("discards page title when it includes story name or site suffix", () => {
    expect(pickChapterTitle("Chương 1", "Hãn Phu - Chương 1 - XTruyện", url)).toBe("Chương 1");
    expect(pickChapterTitle("Chương 599: Sắp Xếp", "Nữ Học Bá : Chương 599: Sắp Xếp - Truyenfull.vn", url)).toBe(
      "Chương 599: Sắp Xếp"
    );
  });

  it("keeps TOC title when page gives nothing more", () => {
    expect(pickChapterTitle("Chương 1", "Chương 1", url)).toBe("Chương 1");
    expect(pickChapterTitle("Chương 1", "", url)).toBe("Chương 1");
  });

  it("manual crawl (empty TOC or just URL) uses page title", () => {
    expect(pickChapterTitle(undefined, "Chương 1: Ly hương", url)).toBe("Chương 1: Ly hương");
    expect(pickChapterTitle(url, "Chương 1: Ly hương", url)).toBe("Chương 1: Ly hương");
  });
});
