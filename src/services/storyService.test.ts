import { describe, expect, it } from "vitest";
import { ContentBlock, StoredStory } from "../types";
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
    expect(merged.title).toBe("Truyện A");
    expect(merged.createdAt).toBe("2026-09-17T00:00:00.000Z");
    expect(merged.updatedAt).toBe("2026-09-17T00:00:00.000Z");
    expect(merged.author).toBe("Tác giả");
  });

  it("falls back to Untitled when there is no existing story and no TOC title", () => {
    const merged = mergeStory({
      site: "example.com",
      storyUrl: "https://example.com/a/",
      toc: { ...toc, title: undefined as unknown as string },
    });
    expect(merged.title).toBe("Untitled");
  });

  it("keeps status/blocks/error/title of old chapters by URL, adds new chapters as pending", () => {
    const merged = mergeStory({ existing: existingStory(), site: "example.com", storyUrl: "https://example.com/a/", toc });
    expect(merged.chapters[0]).toMatchObject({ status: "done", title: "Chương 1 (sửa)" });
    expect(merged.chapters[0].blocks).toEqual([{ type: "paragraph", text: "x" }]);
    expect(merged.chapters[1]).toMatchObject({ status: "error", title: "Chương 2" });
    expect(merged.chapters[1].error).toBe("timeout");
    expect(merged.chapters[2]).toMatchObject({ status: "pending" });
    expect(merged.createdAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("prefers the TOC coverUrl, but keeps the saved cover when the TOC omits it", () => {
    const withTocCover = mergeStory({
      existing: existingStory({ coverUrl: "https://old.example.com/cover.jpg" }),
      site: "example.com",
      storyUrl: "https://example.com/a/",
      toc,
    });
    expect(withTocCover.coverUrl).toBe("https://example.com/cover.jpg");

    const withoutTocCover = mergeStory({
      existing: existingStory({ coverUrl: "https://old.example.com/cover.jpg" }),
      site: "example.com",
      storyUrl: "https://example.com/a/",
      toc: { ...toc, coverUrl: undefined },
    });
    expect(withoutTocCover.coverUrl).toBe("https://old.example.com/cover.jpg");
  });

  it("drops chapters that disappeared from the refreshed TOC", () => {
    const merged = mergeStory({
      existing: existingStory(),
      site: "example.com",
      storyUrl: "https://example.com/a/",
      toc: { ...toc, chapters: [toc.chapters[0]] },
    });
    expect(merged.chapters.map((c) => c.url)).toEqual([toc.chapters[0].url]);
  });

  it("renumbers chapters by refreshed TOC order and keeps progress per URL", () => {
    const merged = mergeStory({
      existing: existingStory(),
      site: "example.com",
      storyUrl: "https://example.com/a/",
      toc: {
        ...toc,
        chapters: [toc.chapters[2], toc.chapters[0], { url: "https://example.com/a/chuong-0/", title: "Chương 0" }],
      },
    });
    expect(merged.chapters.map((c) => c.order)).toEqual([1, 2, 3]);
    expect(merged.chapters.map((c) => c.url)).toEqual([
      "https://example.com/a/chuong-3/",
      "https://example.com/a/chuong-1/",
      "https://example.com/a/chuong-0/",
    ]);
    expect(merged.chapters[0]).toMatchObject({ status: "pending" });
    expect(merged.chapters[1]).toMatchObject({ status: "done", title: "Chương 1 (sửa)" });
    expect(merged.chapters[2]).toMatchObject({ status: "pending" });
  });

  it("refreshes a pending chapter from the TOC title and falls back when an old title is empty", () => {
    const merged = mergeStory({
      existing: existingStory({
        chapters: [
          { order: 1, url: "https://example.com/a/chuong-1/", title: "", status: "done" },
          {
            order: 2,
            url: "https://example.com/a/chuong-2/",
            title: "Tên cũ",
            status: "pending",
            blocks: [{ type: "paragraph", text: "cũ" }],
          },
        ],
      }),
      site: "example.com",
      storyUrl: "https://example.com/a/",
      toc,
    });
    expect(merged.chapters[0]).toMatchObject({ status: "done", title: "Chương 1" });
    expect(merged.chapters[1]).toEqual({
      order: 2,
      url: "https://example.com/a/chuong-2/",
      title: "Chương 2",
      status: "pending",
    });
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
    expect(merged.updatedAt).toBe(new Date(merged.updatedAt).toISOString());
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

  it("counts every TOC entry when nothing is stored, duplicates included", () => {
    expect(
      countNewChapters([], [
        { url: "https://example.com/a/chuong-1/", title: "Chương 1" },
        { url: "https://example.com/a/chuong-1/", title: "Chương 1 (lặp)" },
        { url: "https://example.com/a/chuong-2/", title: "Chương 2" },
      ])
    ).toBe(3);
  });

  it("counts duplicate new URLs separately", () => {
    expect(
      countNewChapters([{ url: "https://example.com/a/chuong-1/" }], [
        { url: "https://example.com/a/chuong-1/", title: "Chương 1" },
        { url: "https://example.com/a/chuong-2/", title: "Chương 2" },
        { url: "https://example.com/a/chuong-2/", title: "Chương 2 (lặp)" },
      ])
    ).toBe(2);
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

  it("treats an empty orders list as no orders", () => {
    const story = existingStory();
    story.chapters.push({ order: 3, url: "https://example.com/a/chuong-3/", title: "Chương 3", status: "pending" });
    expect(chaptersToCrawl(story, []).map((c) => c.order)).toEqual([2, 3]);
  });

  it("sorts by order whatever the array and orders order", () => {
    const story = existingStory({
      chapters: [
        { order: 3, url: "chuong-3", title: "Chương 3", status: "pending" },
        { order: 1, url: "chuong-1", title: "Chương 1", status: "error" },
        { order: 2, url: "chuong-2", title: "Chương 2", status: "done" },
      ],
    });
    expect(chaptersToCrawl(story).map((c) => c.order)).toEqual([1, 3]);
    expect(chaptersToCrawl(story, [3, 1]).map((c) => c.order)).toEqual([1, 3]);
  });

  it("returns nothing for a story with no chapters or only done chapters", () => {
    expect(chaptersToCrawl(existingStory({ chapters: [] }))).toEqual([]);
    expect(
      chaptersToCrawl(existingStory({ chapters: [{ order: 1, url: "chuong-1", title: "Chương 1", status: "done" }] }))
    ).toEqual([]);
  });

  it("skips non-existent order", () => {
    expect(chaptersToCrawl(existingStory(), [99])).toEqual([]);
  });
});

describe("toExtractedChapter", () => {
  it("done chapter: returns its blocks unchanged", () => {
    const blocks: ContentBlock[] = [
      { type: "paragraph", text: "nội dung" },
      { type: "image", src: "https://example.com/a.jpg" },
    ];
    expect(toExtractedChapter({ order: 1, url: "u", title: "t", status: "done", blocks })).toEqual({
      sourceUrl: "u",
      title: "t",
      blocks,
    });
  });

  it("pending chapter without blocks: returns an empty blocks array", () => {
    expect(toExtractedChapter({ order: 2, url: "u2", title: "t2", status: "pending" })).toEqual({
      sourceUrl: "u2",
      title: "t2",
      blocks: [],
    });
  });

  it("error chapter: returns error and empty blocks, Unknown error when error missing", () => {
    expect(toExtractedChapter({ order: 3, url: "u3", title: "t3", status: "error", error: "lỗi" })).toEqual({
      sourceUrl: "u3",
      title: "t3",
      blocks: [],
      error: "lỗi",
    });
    expect(toExtractedChapter({ order: 4, url: "u4", title: "t4", status: "error" })).toEqual({
      sourceUrl: "u4",
      title: "t4",
      blocks: [],
      error: "Unknown error",
    });
  });

  it("error chapter with stored blocks: returns empty blocks", () => {
    expect(
      toExtractedChapter({
        order: 5,
        url: "u5",
        title: "t5",
        status: "error",
        error: "lỗi",
        blocks: [{ type: "paragraph", text: "cũ" }],
      })
    ).toEqual({ sourceUrl: "u5", title: "t5", blocks: [], error: "lỗi" });
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

  it("compares titles ignoring extra whitespace and case", () => {
    expect(pickChapterTitle("chương  1", "CHƯƠNG 1: Mở cửa", url)).toBe("CHƯƠNG 1: Mở cửa");
    expect(pickChapterTitle("  Chương 1  ", "Chương 1", url)).toBe("Chương 1");
  });

  it("falls back to the URL when neither TOC nor page title has content", () => {
    expect(pickChapterTitle(undefined, "   ", url)).toBe(url);
    expect(pickChapterTitle("", "", url)).toBe(url);
    expect(pickChapterTitle(url, "\t\n ", url)).toBe(url);
  });
});
