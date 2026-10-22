import { describe, expect, it } from "vitest";
import { ChapterLine } from "../../lib/skins/chapterLines";
import {
  FILE_WIDTH,
  displayWidth,
  fileBytes,
  fileRows,
  fileWidth,
  findRow,
  fold,
  lineAtRow,
  matchRanges,
  rowOfLine,
  wrapText,
} from "./text";

describe("wrapText", () => {
  it("wraps on spaces within the width", () => {
    expect(wrapText("một hai ba bốn năm sáu", 10)).toEqual(["một hai ba", "bốn năm", "sáu"]);
  });

  it("never makes a row wider than the width, splitting a word too long for one", () => {
    const rows = wrapText("a ".repeat(3) + "x".repeat(25), 10);
    expect(rows).toEqual(["a a a", "xxxxxxxxxx", "xxxxxxxxxx", "xxxxx"]);
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(10);
  });

  it("counts wide characters as two cells and composed Vietnamese as one", () => {
    expect(displayWidth("Trở về")).toBe(6);
    expect(displayWidth("Trở về".normalize("NFD"))).toBe(6);
    expect(displayWidth("漢字")).toBe(4);
    expect(wrapText("漢字漢字漢字", 5)).toEqual(["漢字", "漢字", "漢字"]);
  });

  it("returns nothing for empty text", () => {
    expect(wrapText("", 10)).toEqual([]);
  });
});

describe("fileWidth", () => {
  it("wraps at the file measure, or narrower in a narrow window", () => {
    expect(fileWidth(200)).toBe(FILE_WIDTH);
    expect(fileWidth(60)).toBe(59);
    expect(fileWidth(5)).toBe(20);
  });
});

const LINES: ChapterLine[] = [
  { kind: "heading", text: "Chương 1" },
  { kind: "text", text: "Đoạn một khá dài để phải xuống dòng ở đây." },
  { kind: "media", text: "[image: minh họa]" },
  { kind: "text", text: "Đoạn ba." },
];

describe("fileRows", () => {
  it("draws headings as Markdown, a blank row between blocks, media as placeholders", () => {
    const rows = fileRows(LINES, 24);
    expect(rows.map((row) => row.text)).toEqual([
      "# Chương 1",
      "",
      "Đoạn một khá dài để phải",
      "xuống dòng ở đây.",
      "",
      "[image: minh họa]",
      "",
      "Đoạn ba.",
    ]);
    expect(rows.map((row) => row.line)).toEqual([0, 0, 1, 1, 1, 2, 2, 3]);
    expect(rows[5].kind).toBe("media");
  });

  it("maps a chapter line to its first row and a row back to its line", () => {
    const rows = fileRows(LINES, 24);
    expect(rowOfLine(rows, 0)).toBe(0);
    expect(rowOfLine(rows, 1)).toBe(2);
    expect(rowOfLine(rows, 3)).toBe(7);
    expect(rowOfLine(rows, 99)).toBe(7);
    expect(lineAtRow(rows, 3)).toBe(1);
    // A blank row belongs to the paragraph after it.
    expect(lineAtRow(rows, 4)).toBe(2);
  });

  it("counts the file's bytes as UTF-8 with a newline per row", () => {
    expect(fileBytes(fileRows([{ kind: "text", text: "ab" }], 80))).toBe(3);
    expect(fileBytes(fileRows([{ kind: "text", text: "ở" }], 80))).toBe(4);
    expect(fileBytes([])).toBe(0);
  });
});

describe("search", () => {
  it("folds case and Vietnamese marks one character for one", () => {
    expect(fold("Trở VỀ Đâu")).toBe("tro ve dau");
    expect(fold("Trở về").length).toBe("Trở về".length);
  });

  it("finds matches where they are on screen", () => {
    expect(matchRanges("Anh trở về, trở lại", "tro")).toEqual([
      [4, 7],
      [12, 15],
    ]);
    expect(matchRanges("abc", "")).toEqual([]);
  });

  it("finds the next row with the pattern, either way", () => {
    const rows = fileRows(LINES, 24);
    expect(findRow(rows, "doan", -1, 1)).toBe(2);
    expect(findRow(rows, "doan", 2, 1)).toBe(7);
    expect(findRow(rows, "doan", 7, -1)).toBe(2);
    expect(findRow(rows, "khong co", 0, 1)).toBe(-1);
  });
});
