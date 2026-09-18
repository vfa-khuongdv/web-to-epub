import { describe, expect, it } from "vitest";
import { StoredStory } from "../types";
import { TocResult } from "./toc/types";
import { chaptersToCrawl, mergeStory, pickChapterTitle, toExtractedChapter } from "./storyService";

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
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeStory", () => {
  it("tạo mới khi chưa có: mọi chương pending, giữ createdAt mới", () => {
    const merged = mergeStory({ site: "example.com", storyUrl: "https://example.com/a/", toc, now: "2026-09-17T00:00:00.000Z" });
    expect(merged.chapters.map((c) => c.status)).toEqual(["pending", "pending", "pending"]);
    expect(merged.chapters.map((c) => c.order)).toEqual([1, 2, 3]);
    expect(merged.createdAt).toBe("2026-09-17T00:00:00.000Z");
    expect(merged.author).toBe("Tác giả");
  });

  it("giữ status/blocks/error/title của chương cũ theo URL, thêm chương mới là pending", () => {
    const merged = mergeStory({ existing: existingStory(), site: "example.com", storyUrl: "https://example.com/a/", toc });
    expect(merged.chapters[0]).toMatchObject({ status: "done", title: "Chương 1 (sửa)" });
    expect(merged.chapters[1]).toMatchObject({ status: "error", error: "timeout" });
    expect(merged.chapters[2]).toMatchObject({ status: "pending" });
    expect(merged.createdAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("giữ tên/tác giả/ngôn ngữ người dùng đã lưu khi nạp lại TOC", () => {
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
});

describe("chaptersToCrawl", () => {
  it("mặc định chỉ chương chưa done (pending + error), giữ thứ tự", () => {
    const story = existingStory();
    story.chapters.push({ order: 3, url: "https://example.com/a/chuong-3/", title: "Chương 3", status: "pending" });
    expect(chaptersToCrawl(story).map((c) => c.order)).toEqual([2, 3]);
  });

  it("có orders thì trả đúng các order đó, kể cả chương done", () => {
    const story = existingStory();
    expect(chaptersToCrawl(story, [1]).map((c) => c.order)).toEqual([1]);
  });

  it("bỏ qua order không tồn tại", () => {
    expect(chaptersToCrawl(existingStory(), [99])).toEqual([]);
  });
});

describe("toExtractedChapter", () => {
  it("chương done: trả blocks; chương error: trả error", () => {
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

  it("lấy tên trang khi nó là bản đầy đủ hơn của tên mục lục", () => {
    expect(pickChapterTitle("Quyển 1 Chương 2", "Quyển 1 Chương 2 : Mở cửa", url)).toBe("Quyển 1 Chương 2 : Mở cửa");
    expect(pickChapterTitle("Chương 1", "Chương 1: Sơn biên tiểu thôn", url)).toBe("Chương 1: Sơn biên tiểu thôn");
  });

  it("bỏ tên trang khi nó kèm tên truyện hoặc hậu tố website", () => {
    expect(pickChapterTitle("Chương 1", "Hãn Phu - Chương 1 - XTruyện", url)).toBe("Chương 1");
    expect(pickChapterTitle("Chương 599: Sắp Xếp", "Nữ Học Bá : Chương 599: Sắp Xếp - Truyenfull.vn", url)).toBe(
      "Chương 599: Sắp Xếp"
    );
  });

  it("giữ tên mục lục khi trang không cho tên gì hơn", () => {
    expect(pickChapterTitle("Chương 1", "Chương 1", url)).toBe("Chương 1");
    expect(pickChapterTitle("Chương 1", "", url)).toBe("Chương 1");
  });

  it("crawl thủ công (mục lục trống hoặc chỉ là URL) thì dùng tên trang", () => {
    expect(pickChapterTitle(undefined, "Chương 1: Ly hương", url)).toBe("Chương 1: Ly hương");
    expect(pickChapterTitle(url, "Chương 1: Ly hương", url)).toBe("Chương 1: Ly hương");
  });
});
