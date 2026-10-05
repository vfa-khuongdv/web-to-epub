import { describe, expect, it } from "vitest";
import { StoredChapter, StorySummary } from "../../types";
import { adjacentChapter, chapterRows, libraryRows, shownStatus, sortChapters, storyRows } from "./sheetRows";

const summary = (id: string, title: string, extra: Partial<StorySummary> = {}): StorySummary => ({
  id,
  storyUrl: `https://example.test/${id}`,
  site: "example.test",
  title,
  chapterCount: 1200,
  doneCount: 150,
  errorCount: 0,
  watching: false,
  newChapterCount: 0,
  updatedAt: "2026-10-01T08:00:00",
  ...extra,
});

const chapter = (order: number, status: StoredChapter["status"], title = `Chương ${order}`): StoredChapter => ({
  order,
  url: `https://example.test/c/${order}`,
  title,
  status,
});

const texts = (cells: { text: string }[]) => cells.map((cell) => cell.text);

describe("libraryRows", () => {
  const stories = [summary("a", "Trở Về Thời Niên Thiếu"), summary("b", "Kiếm Lai", { errorCount: 3 })];

  it("lists one story per row under a bold header row", () => {
    const rows = libraryRows(stories, {}, false, 0);
    expect(rows[0].header).toBe(true);
    expect(texts(rows[0].cells)).toEqual(["STT", "Mã", "Tên", "Số chương", "Đã tải", "Lỗi", "Cập nhật", "Tiến độ"]);
    expect(texts(rows[1].cells)).toEqual(["1", "tro_ve_thoi_nien_thieu", "Trở Về Thời Niên Thiếu", "1,200", "150", "0", "01/10/2026", ""]);
    expect(rows[1].label).toBe(2);
    expect(rows[1].target).toBe("a");
    expect(rows[2].cells[5].tone).toBe("negative");
  });

  it("hides every title behind neutral names", () => {
    const rows = libraryRows(stories, {}, true, 0);
    const shown = rows.flatMap((row) => texts(row.cells)).join(" ");
    expect(shown).not.toContain("Kiếm");
    expect(shown).not.toContain("kiem");
    expect(texts(rows[2].cells).slice(1, 3)).toEqual(["Sheet2", "Module 02"]);
  });

  it("shows a running crawl's progress", () => {
    const rows = libraryRows(stories, { b: { cursor: 12, total: 150, errors: 0 } }, false, 0);
    expect(rows[2].cells[7].text).toBe("12/150");
  });

  it("numbers rows by their place in the whole list on later pages", () => {
    const many = Array.from({ length: 205 }, (_, index) => summary(String(index), `Truyện ${index}`));
    const rows = libraryRows(many, {}, false, 1);
    expect(rows).toHaveLength(6);
    expect(rows[1].label).toBe(202);
    expect(rows[1].cells[0].text).toBe("201");
  });
});

describe("storyRows", () => {
  const chapters = [chapter(1, "done", "Gặp lại"), chapter(2, "pending"), chapter(3, "error")];

  it("shows each chapter's status and lets only done chapters open", () => {
    const rows = storyRows(chapters, 0, false, { 1: 2345 }, undefined);
    expect(texts(rows[1].cells)).toEqual(["1", "Gặp lại", "Xong", "2,345"]);
    expect(rows[1].target).toBe(1);
    expect(texts(rows[2].cells)).toEqual(["2", "Chương 2", "Chờ", ""]);
    expect(rows[2].target).toBeUndefined();
    expect(rows[2].blocked).toBe("pending");
    expect(rows[3].cells[2]).toMatchObject({ text: "Lỗi", tone: "negative" });
    expect(rows[3].blocked).toBe("error");
    expect(rows[1].blocked).toBeUndefined();
  });

  it("hides chapter titles behind neutral names", () => {
    const rows = storyRows(chapters, 0, true, {}, undefined);
    expect(rows[1].cells[1].text).toBe("Mục 0001");
    expect(rows.flatMap((row) => texts(row.cells)).join(" ")).not.toContain("Gặp");
  });

  it("lays the running crawl over pending chapters", () => {
    const live = { [chapters[1].url]: "done" as const };
    expect(shownStatus(chapters[1], live)).toBe("done");
    expect(shownStatus(chapters[2], { [chapters[2].url]: "done" })).toBe("error");
    expect(storyRows(chapters, 0, false, {}, live)[2].target).toBe(2);
  });

  it("draws at most a page of chapters", () => {
    const long = Array.from({ length: 450 }, (_, index) => chapter(index + 1, "done"));
    const rows = storyRows(long, 2, false, {}, undefined);
    expect(rows).toHaveLength(51);
    expect(rows[1].cells[0].text).toBe("401");
  });
});

describe("chapterRows", () => {
  it("puts one line per row in column B, numbered in column A", () => {
    const rows = chapterRows([
      { kind: "heading", text: "Chương 12" },
      { kind: "text", text: "Trời đã sáng." },
      { kind: "media", text: "[image]" },
    ]);
    expect(rows).toHaveLength(4);
    expect(texts(rows[1].cells)).toEqual(["1", "Chương 12"]);
    expect(rows[1].cells[1].bold).toBe(true);
    expect(rows[2].label).toBe(3);
    expect(rows[3].cells[1]).toMatchObject({ italic: true, tone: "dim" });
  });
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
