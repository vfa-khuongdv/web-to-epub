import { describe, expect, it } from "vitest";
import { StoredChapter } from "../../types";
import { adjacentChapter, sortChapters } from "./chapters";

const chapter = (order: number, status: StoredChapter["status"]): StoredChapter => ({
  order,
  url: `https://example.test/c/${order}`,
  title: `Chương ${order}`,
  status,
});

describe("adjacentChapter", () => {
  const sorted = sortChapters([chapter(5, "done"), chapter(1, "done"), chapter(3, "pending"), chapter(4, "error"), chapter(2, "done")]);

  it("skips chapters without text", () => {
    expect(adjacentChapter(sorted, 2, 1)).toBe(5);
    expect(adjacentChapter(sorted, 5, -1)).toBe(2);
    expect(adjacentChapter(sorted, 5, 1)).toBeNull();
    expect(adjacentChapter(sorted, 1, -1)).toBeNull();
  });

  it("counts a chapter the running crawl just finished", () => {
    expect(adjacentChapter(sorted, 2, 1, { [sorted[2].url]: "done" })).toBe(3);
  });
});
