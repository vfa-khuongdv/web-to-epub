// The open sheets of the spreadsheet skin and what is selected on each — a reducer, so the
// tab rules (the library sheet always first and never closed, at most MAX_SHEETS open,
// one chapter sheet per story that follows next/previous chapter) are tested on their own.

import { CellPos, HEADER_ROWS, MAX_SHEETS } from "./sheetModel";

export type SheetRef =
  | { kind: "library" }
  | { kind: "story"; storyId: string }
  | { kind: "chapter"; storyId: string; order: number };

export const LIBRARY_KEY = "library";

export function sheetKey(ref: SheetRef): string {
  if (ref.kind === "library") return LIBRARY_KEY;
  return `${ref.kind}:${ref.storyId}`;
}

// The key a view's scroll position and selection belong to: a chapter sheet that moved to
// another chapter is a fresh view.
export function viewKey(ref: SheetRef): string {
  return ref.kind === "chapter" ? `chapter:${ref.storyId}:${ref.order}` : sheetKey(ref);
}

export interface WorkbookState {
  tabs: SheetRef[];
  active: string;
  // Per view key.
  selections: Record<string, CellPos>;
  // Per sheet key (library and story sheets are paged).
  pages: Record<string, number>;
  // Bumped when the selected cell should be scrolled into view.
  reveal: number;
}

export const INITIAL_WORKBOOK: WorkbookState = {
  tabs: [{ kind: "library" }],
  active: LIBRARY_KEY,
  selections: {},
  pages: {},
  reveal: 0,
};

export type WorkbookAction =
  | { type: "open"; ref: SheetRef; selection?: CellPos; page?: number }
  | { type: "activate"; key: string }
  // Ctrl/Cmd+PageDown (+1) and PageUp (-1).
  | { type: "step"; delta: number }
  | { type: "close"; key: string }
  | { type: "select"; pos: CellPos; reveal?: boolean }
  | { type: "page"; key: string; page: number; selection?: CellPos };

export function activeRef(state: WorkbookState): SheetRef {
  return state.tabs.find((tab) => sheetKey(tab) === state.active) ?? state.tabs[0];
}

export function defaultSelection(ref: SheetRef): CellPos {
  return { row: HEADER_ROWS, col: ref.kind === "chapter" ? 1 : 0 };
}

export function selectionOf(state: WorkbookState, ref: SheetRef): CellPos {
  return state.selections[viewKey(ref)] ?? defaultSelection(ref);
}

// Adds a sheet, or updates the open one with the same key in place (a chapter sheet moving
// to another chapter). Past the limit the oldest other sheet is dropped, never the library.
export function openTab(tabs: SheetRef[], ref: SheetRef, max = MAX_SHEETS): SheetRef[] {
  const key = sheetKey(ref);
  const at = tabs.findIndex((tab) => sheetKey(tab) === key);
  if (at >= 0) {
    const next = tabs.slice();
    next[at] = ref;
    return next;
  }
  const next = [...tabs, ref];
  while (next.length > max) {
    const drop = next.findIndex((tab) => tab.kind !== "library" && sheetKey(tab) !== key);
    if (drop < 0) break;
    next.splice(drop, 1);
  }
  return next;
}

// The tab beside the given one (no wrapping, like Ctrl+PageDown in a spreadsheet).
export function neighborKey(tabs: SheetRef[], key: string, delta: number): string {
  const at = Math.max(0, tabs.findIndex((tab) => sheetKey(tab) === key));
  const to = Math.min(tabs.length - 1, Math.max(0, at + delta));
  return sheetKey(tabs[to]);
}

export function workbookReducer(state: WorkbookState, action: WorkbookAction): WorkbookState {
  switch (action.type) {
    case "open": {
      const key = sheetKey(action.ref);
      const view = viewKey(action.ref);
      const selections = action.selection ? { ...state.selections, [view]: action.selection } : state.selections;
      const pages = action.page !== undefined ? { ...state.pages, [key]: action.page } : state.pages;
      return {
        tabs: openTab(state.tabs, action.ref),
        active: key,
        selections,
        pages,
        reveal: state.reveal + 1,
      };
    }
    case "activate":
      if (!state.tabs.some((tab) => sheetKey(tab) === action.key) || action.key === state.active) return state;
      return { ...state, active: action.key };
    case "step":
      return workbookReducer(state, { type: "activate", key: neighborKey(state.tabs, state.active, action.delta) });
    case "close": {
      if (action.key === LIBRARY_KEY) return state;
      const at = state.tabs.findIndex((tab) => sheetKey(tab) === action.key);
      if (at < 0) return state;
      const tabs = state.tabs.filter((_, index) => index !== at);
      const active = state.active === action.key ? sheetKey(tabs[Math.max(0, at - 1)]) : state.active;
      return { ...state, tabs, active };
    }
    case "select": {
      const view = viewKey(activeRef(state));
      return {
        ...state,
        selections: { ...state.selections, [view]: action.pos },
        reveal: action.reveal ? state.reveal + 1 : state.reveal,
      };
    }
    case "page": {
      const ref = state.tabs.find((tab) => sheetKey(tab) === action.key);
      if (!ref) return state;
      const selections = action.selection
        ? { ...state.selections, [viewKey(ref)]: action.selection }
        : state.selections;
      return { ...state, pages: { ...state.pages, [action.key]: action.page }, selections, reveal: state.reveal + 1 };
    }
  }
}

// Spreadsheet sheet names are unique; a repeated one gets " (2)", " (3)"… as when a
// sheet is copied.
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

// Story ids whose crawl ended between two snapshots of the live channel (comma lists).
export function endedCrawls(before: string, after: string): string[] {
  const still = new Set(after.split(",").filter(Boolean));
  return before.split(",").filter((id) => id && !still.has(id));
}
