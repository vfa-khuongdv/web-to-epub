// The pager (`less`): which key does what, where the top row may go, and the prompt line
// at the bottom. Pure; Pager.tsx keeps the state and draws it.

export interface PagerView {
  top: number;
  // Text rows on screen (the prompt line not counted).
  height: number;
  total: number;
}

export type PagerAction =
  | { type: "move"; top: number }
  | { type: "quit" }
  | { type: "file"; direction: 1 | -1 }
  | { type: "search"; direction: 1 | -1 }
  | { type: "again"; reverse: boolean }
  | { type: "colon" }
  | { type: "help" }
  | { type: "none" };

export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">;

// The last row that can be at the top: the file's end sits on the bottom line.
export function maxTop(view: Pick<PagerView, "height" | "total">): number {
  return Math.max(0, view.total - Math.max(1, view.height));
}

export function clampTop(top: number, view: Pick<PagerView, "height" | "total">): number {
  return Math.min(maxTop(view), Math.max(0, Math.round(top)));
}

/** less's own keys (the common ones), plus ] and [ for the next and previous file. */
export function pagerKey(event: KeyLike, view: PagerView): PagerAction {
  if (event.metaKey || event.altKey) return { type: "none" };
  const page = Math.max(1, view.height);
  const half = Math.max(1, Math.floor(page / 2));
  const move = (top: number): PagerAction => ({ type: "move", top: clampTop(top, view) });
  if (event.ctrlKey) {
    switch (event.key.toLowerCase()) {
      case "f":
      case "v":
        return move(view.top + page);
      case "b":
        return move(view.top - page);
      case "d":
        return move(view.top + half);
      case "u":
        return move(view.top - half);
      case "n":
      case "e":
        return move(view.top + 1);
      case "p":
      case "y":
        return move(view.top - 1);
      default:
        return { type: "none" };
    }
  }
  switch (event.key) {
    case " ":
    case "f":
    case "z":
    case "PageDown":
      return move(view.top + page);
    case "b":
    case "w":
    case "PageUp":
      return move(view.top - page);
    case "j":
    case "e":
    case "ArrowDown":
    case "Enter":
      return move(view.top + 1);
    case "k":
    case "y":
    case "ArrowUp":
      return move(view.top - 1);
    case "d":
      return move(view.top + half);
    case "u":
      return move(view.top - half);
    case "g":
    case "<":
    case "Home":
      return move(0);
    case "G":
    case ">":
    case "End":
      return move(maxTop(view));
    case "q":
    case "Q":
      return { type: "quit" };
    case "]":
      return { type: "file", direction: 1 };
    case "[":
      return { type: "file", direction: -1 };
    case "/":
      return { type: "search", direction: 1 };
    case "?":
      return { type: "search", direction: -1 };
    case "n":
      return { type: "again", reverse: false };
    case "N":
      return { type: "again", reverse: true };
    case ":":
      return { type: "colon" };
    case "h":
    case "H":
      return { type: "help" };
    default:
      return { type: "none" };
  }
}

// After ":" less reads one more key: n/p are the next/previous file, q quits.
export function colonKey(key: string): PagerAction {
  if (key === "n") return { type: "file", direction: 1 };
  if (key === "p") return { type: "file", direction: -1 };
  if (key === "q" || key === "Q") return { type: "quit" };
  return { type: "none" };
}

/**
 * The prompt line in less's -M style: "name lines 41-80/220 36%", "(END)" at the end,
 * and "(file 3 of 12)" right after the file was opened with :n or :p.
 */
export function pagerStatus(input: { name: string; view: PagerView; fileIndex?: { at: number; of: number } | null }): string {
  const { name, view, fileIndex } = input;
  const file = fileIndex ? ` (file ${fileIndex.at} of ${fileIndex.of})` : "";
  if (view.total === 0) return `${name}${file} (END)`;
  const first = Math.min(view.total, view.top + 1);
  const last = Math.min(view.total, view.top + view.height);
  const position = last >= view.total ? "(END)" : `${Math.floor((last / view.total) * 100)}%`;
  return `${name}${file} lines ${first}-${last}/${view.total} ${position}`;
}

// Wheel deltas in pixels (or lines, or pages) to whole rows, keeping the remainder.
export function wheelRows(deltaY: number, deltaMode: number, rowHeight: number, carry: number): { rows: number; carry: number } {
  const pixels = deltaMode === 1 ? deltaY * rowHeight : deltaMode === 2 ? deltaY * rowHeight * 20 : deltaY;
  const total = carry + pixels / Math.max(1, rowHeight);
  const rows = total > 0 ? Math.floor(total) : Math.ceil(total);
  return { rows, carry: total - rows };
}
