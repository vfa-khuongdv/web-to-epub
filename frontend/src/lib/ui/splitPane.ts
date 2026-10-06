// Where the library list ends and the story page begins, as the list's share of the workbench width.
const SPLIT_KEY = "workbench-split";
export const DEFAULT_SPLIT = 29 / 50;
export const MIN_SPLIT = 0.25;
export const MAX_SPLIT = 0.75;

export const clampSplit = (value: number): number =>
  Number.isFinite(value) ? Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value)) : DEFAULT_SPLIT;

// localStorage can throw (private window, cookies blocked): the split still moves, just is not remembered.
export function readSplit(): number {
  try {
    const saved = localStorage.getItem(SPLIT_KEY);
    return saved === null ? DEFAULT_SPLIT : clampSplit(Number(saved));
  } catch {
    return DEFAULT_SPLIT;
  }
}

export function saveSplit(value: number): void {
  try {
    localStorage.setItem(SPLIT_KEY, String(clampSplit(value)));
  } catch {
    /* not remembered */
  }
}
