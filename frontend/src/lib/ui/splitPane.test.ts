import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SPLIT, MAX_SPLIT, MIN_SPLIT, clampSplit, readSplit, saveSplit } from "./splitPane";

const memory = (init: Record<string, string> = {}) => {
  const data = { ...init };
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  };
  return data;
};
afterEach(() => delete (globalThis as { localStorage?: unknown }).localStorage);

describe("splitPane", () => {
  it("keeps the split between its limits and falls back on nonsense", () => {
    expect(clampSplit(0.1)).toBe(MIN_SPLIT);
    expect(clampSplit(0.95)).toBe(MAX_SPLIT);
    expect(clampSplit(0.5)).toBe(0.5);
    expect(clampSplit(Number.NaN)).toBe(DEFAULT_SPLIT);
  });

  it("remembers the split, and starts from the default when nothing (or junk) is saved", () => {
    memory();
    expect(readSplit()).toBe(DEFAULT_SPLIT);
    saveSplit(0.4);
    expect(readSplit()).toBe(0.4);
    memory({ "workbench-split": "wide" });
    expect(readSplit()).toBe(DEFAULT_SPLIT);
  });

  it("still works when storage throws", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSplit()).toBe(DEFAULT_SPLIT);
    expect(() => saveSplit(0.4)).not.toThrow();
  });
});
