import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  cellAddress,
  chapterSheetName,
  clampPage,
  columnName,
  formatDate,
  lineToRow,
  moveSelection,
  pageBounds,
  pageCount,
  pageOfIndex,
  pagedMove,
  rowToLine,
  selectionSummary,
} from "./sheetModel";

describe("columnName", () => {
  const cases: [number, string][] = [
    [0, "A"],
    [1, "B"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
    [702, "AAA"],
  ];
  for (const [index, name] of cases) {
    it(`names column ${index} ${name}`, () => expect(columnName(index)).toBe(name));
  }

  it("builds a cell address from a column index and a row label", () => {
    expect(cellAddress(1, 12)).toBe("B12");
    expect(cellAddress(5, 17)).toBe("F17");
  });
});

describe("paging", () => {
  it("counts at least one page, even for an empty sheet", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(PAGE_SIZE)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
    expect(pageCount(2431)).toBe(13);
  });

  it("clamps a page into range", () => {
    expect(clampPage(-3, 500)).toBe(0);
    expect(clampPage(9, 500)).toBe(2);
    expect(clampPage(1, 0)).toBe(0);
  });

  it("gives each page's slice, the last one short", () => {
    expect(pageBounds(0, 450)).toEqual({ start: 0, end: 200 });
    expect(pageBounds(2, 450)).toEqual({ start: 400, end: 450 });
    expect(pageBounds(7, 450)).toEqual({ start: 400, end: 450 });
    expect(pageBounds(0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("finds the page an item sits on", () => {
    expect(pageOfIndex(0)).toBe(0);
    expect(pageOfIndex(199)).toBe(0);
    expect(pageOfIndex(200)).toBe(1);
  });
});

describe("moveSelection", () => {
  const at = { row: 3, col: 2 };
  const move = (key: string, jump = false) => moveSelection(at, { key, jump }, 10, 6);

  it("steps one cell with the arrows", () => {
    expect(move("ArrowUp")).toEqual({ row: 2, col: 2 });
    expect(move("ArrowDown")).toEqual({ row: 4, col: 2 });
    expect(move("ArrowLeft")).toEqual({ row: 3, col: 1 });
    expect(move("ArrowRight")).toEqual({ row: 3, col: 3 });
  });

  it("jumps to the edges with Ctrl/Cmd", () => {
    expect(move("ArrowUp", true)).toEqual({ row: 0, col: 2 });
    expect(move("ArrowDown", true)).toEqual({ row: 9, col: 2 });
    expect(move("ArrowLeft", true)).toEqual({ row: 3, col: 0 });
    expect(move("ArrowRight", true)).toEqual({ row: 3, col: 5 });
    expect(move("Home", true)).toEqual({ row: 0, col: 0 });
    expect(move("End", true)).toEqual({ row: 9, col: 5 });
  });

  it("goes to the start and end of the row with Home and End", () => {
    expect(move("Home")).toEqual({ row: 3, col: 0 });
    expect(move("End")).toEqual({ row: 3, col: 5 });
  });

  it("stops at the sheet's edges", () => {
    expect(moveSelection({ row: 0, col: 0 }, { key: "ArrowUp", jump: false }, 10, 6)).toEqual({ row: 0, col: 0 });
    expect(moveSelection({ row: 9, col: 5 }, { key: "ArrowRight", jump: false }, 10, 6)).toEqual({ row: 9, col: 5 });
  });

  it("brings a selection left outside a shrunken sheet back inside", () => {
    expect(moveSelection({ row: 40, col: 1 }, { key: "ArrowLeft", jump: false }, 3, 6)).toEqual({ row: 2, col: 0 });
  });

  it("ignores keys that do not move", () => {
    expect(move("Enter")).toBeNull();
    expect(move("a")).toBeNull();
  });
});

describe("pagedMove", () => {
  const sheet = { rows: 201, cols: 4, page: 1, pages: 3 };

  it("continues on the next page from the last row", () => {
    expect(pagedMove({ row: 200, col: 1 }, { key: "ArrowDown", jump: false }, sheet)).toEqual({
      pos: { row: 1, col: 1 },
      page: 2,
    });
  });

  it("goes back to the previous page's last row from the first data row", () => {
    expect(pagedMove({ row: 1, col: 2 }, { key: "ArrowUp", jump: false }, sheet)).toEqual({
      pos: { row: 200, col: 2 },
      page: 0,
    });
  });

  it("stays on the page at the first and last page", () => {
    expect(pagedMove({ row: 1, col: 0 }, { key: "ArrowUp", jump: false }, { ...sheet, page: 0 })).toEqual({
      pos: { row: 0, col: 0 },
      page: 0,
    });
    expect(pagedMove({ row: 50, col: 0 }, { key: "ArrowDown", jump: false }, { rows: 51, cols: 4, page: 2, pages: 3 })).toEqual({
      pos: { row: 50, col: 0 },
      page: 2,
    });
  });

  it("moves inside the page otherwise", () => {
    expect(pagedMove({ row: 5, col: 0 }, { key: "ArrowDown", jump: false }, sheet)).toEqual({
      pos: { row: 6, col: 0 },
      page: 1,
    });
    expect(pagedMove({ row: 5, col: 0 }, { key: "Tab", jump: false }, sheet)).toBeNull();
  });
});

describe("chapter sheet rows", () => {
  it("puts line i on row i + 1, under the header row", () => {
    expect(lineToRow(0)).toBe(1);
    expect(lineToRow(41)).toBe(42);
    expect(rowToLine(1)).toBe(0);
    expect(rowToLine(42)).toBe(41);
    expect(rowToLine(0)).toBe(0);
  });

  it("names chapter sheets by number, neutral or not", () => {
    expect(chapterSheetName(12, false)).toBe("Ch_0012");
    expect(chapterSheetName(12, true)).toBe("Part_0012");
  });
});

describe("formatDate", () => {
  it("writes dd/mm/yyyy and leaves bad dates blank", () => {
    expect(formatDate("2026-03-07T10:00:00")).toBe("07/03/2026");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
});

describe("selectionSummary", () => {
  it("counts a text cell and its words on a chapter sheet", () => {
    expect(selectionSummary("Trời đã sáng hẳn.", true)).toEqual([
      { label: "Count", value: "1" },
      { label: "Words", value: "4" },
    ]);
  });

  it("sums a number cell", () => {
    expect(selectionSummary("1,250", false)).toEqual([
      { label: "Count", value: "1" },
      { label: "Sum", value: "1,250" },
    ]);
  });

  it("says nothing for an empty cell", () => {
    expect(selectionSummary("  ", true)).toEqual([]);
  });
});
