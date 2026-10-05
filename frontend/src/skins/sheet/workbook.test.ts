import { describe, expect, it } from "vitest";
import {
  INITIAL_WORKBOOK,
  LIBRARY_KEY,
  SheetRef,
  WorkbookState,
  activeRef,
  endedCrawls,
  neighborKey,
  openTab,
  selectionOf,
  sheetKey,
  uniqueNames,
  viewKey,
  workbookReducer,
} from "./workbook";

const story = (storyId: string): SheetRef => ({ kind: "story", storyId });
const chapter = (storyId: string, order: number): SheetRef => ({ kind: "chapter", storyId, order });

describe("sheet keys", () => {
  it("keys a chapter sheet by story, its view by chapter", () => {
    expect(sheetKey(chapter("a", 3))).toBe("chapter:a");
    expect(viewKey(chapter("a", 3))).toBe("chapter:a:3");
    expect(viewKey(story("a"))).toBe("story:a");
    expect(sheetKey({ kind: "library" })).toBe(LIBRARY_KEY);
  });
});

describe("openTab", () => {
  it("appends a new sheet", () => {
    const tabs = openTab(INITIAL_WORKBOOK.tabs, story("a"));
    expect(tabs.map(sheetKey)).toEqual(["library", "story:a"]);
  });

  it("updates a story's chapter sheet in place when it moves to another chapter", () => {
    const tabs = openTab(openTab(INITIAL_WORKBOOK.tabs, chapter("a", 1)), chapter("a", 2));
    expect(tabs).toEqual([{ kind: "library" }, chapter("a", 2)]);
  });

  it("drops the oldest sheet past the limit, never the library", () => {
    let tabs = INITIAL_WORKBOOK.tabs;
    for (const id of ["a", "b", "c", "d"]) tabs = openTab(tabs, story(id), 4);
    expect(tabs.map(sheetKey)).toEqual(["library", "story:b", "story:c", "story:d"]);
  });
});

describe("neighborKey", () => {
  const tabs = [{ kind: "library" } as SheetRef, story("a"), story("b")];

  it("steps to the next and previous tab without wrapping", () => {
    expect(neighborKey(tabs, "story:a", 1)).toBe("story:b");
    expect(neighborKey(tabs, "story:b", 1)).toBe("story:b");
    expect(neighborKey(tabs, "library", -1)).toBe("library");
    expect(neighborKey(tabs, "story:a", -1)).toBe("library");
  });
});

describe("workbookReducer", () => {
  const opened = (state: WorkbookState, ref: SheetRef) => workbookReducer(state, { type: "open", ref });

  it("opens a sheet as the active one, with a selection and a page", () => {
    const state = workbookReducer(INITIAL_WORKBOOK, {
      type: "open",
      ref: story("a"),
      selection: { row: 12, col: 0 },
      page: 2,
    });
    expect(state.active).toBe("story:a");
    expect(selectionOf(state, story("a"))).toEqual({ row: 12, col: 0 });
    expect(state.pages["story:a"]).toBe(2);
    expect(state.reveal).toBe(INITIAL_WORKBOOK.reveal + 1);
  });

  it("selects on the active view only", () => {
    let state = opened(opened(INITIAL_WORKBOOK, story("a")), chapter("a", 4));
    state = workbookReducer(state, { type: "select", pos: { row: 9, col: 1 } });
    expect(selectionOf(state, chapter("a", 4))).toEqual({ row: 9, col: 1 });
    expect(selectionOf(state, chapter("a", 5))).toEqual({ row: 1, col: 1 });
    expect(selectionOf(state, story("a"))).toEqual({ row: 1, col: 0 });
  });

  it("closes a sheet and activates the one to its left", () => {
    let state = opened(opened(INITIAL_WORKBOOK, story("a")), story("b"));
    state = workbookReducer(state, { type: "close", key: "story:b" });
    expect(state.tabs.map(sheetKey)).toEqual(["library", "story:a"]);
    expect(state.active).toBe("story:a");
  });

  it("never closes the library sheet", () => {
    const state = workbookReducer(INITIAL_WORKBOOK, { type: "close", key: LIBRARY_KEY });
    expect(state).toBe(INITIAL_WORKBOOK);
  });

  it("keeps the active sheet when another one closes", () => {
    let state = opened(opened(INITIAL_WORKBOOK, story("a")), story("b"));
    state = workbookReducer(state, { type: "activate", key: "story:a" });
    state = workbookReducer(state, { type: "close", key: "story:b" });
    expect(state.active).toBe("story:a");
    expect(activeRef(state)).toEqual(story("a"));
  });

  it("steps to the neighbouring sheet", () => {
    let state = opened(opened(INITIAL_WORKBOOK, story("a")), story("b"));
    state = workbookReducer(state, { type: "step", delta: -1 });
    expect(state.active).toBe("story:a");
    state = workbookReducer(state, { type: "step", delta: -1 });
    state = workbookReducer(state, { type: "step", delta: -1 });
    expect(state.active).toBe(LIBRARY_KEY);
  });

  it("turns a page and moves the selection with it", () => {
    let state = opened(INITIAL_WORKBOOK, story("a"));
    state = workbookReducer(state, { type: "page", key: "story:a", page: 1, selection: { row: 1, col: 0 } });
    expect(state.pages["story:a"]).toBe(1);
    expect(selectionOf(state, story("a"))).toEqual({ row: 1, col: 0 });
  });
});

describe("uniqueNames", () => {
  it("numbers repeated sheet names", () => {
    expect(uniqueNames(["Danh_muc", "Ch_0001", "Ch_0001", "Ch_0001"])).toEqual([
      "Danh_muc",
      "Ch_0001",
      "Ch_0001 (2)",
      "Ch_0001 (3)",
    ]);
  });
});

describe("endedCrawls", () => {
  it("lists the stories that left the live channel", () => {
    expect(endedCrawls("a,b,c", "b")).toEqual(["a", "c"]);
    expect(endedCrawls("", "a")).toEqual([]);
    expect(endedCrawls("a", "a,b")).toEqual([]);
  });
});
