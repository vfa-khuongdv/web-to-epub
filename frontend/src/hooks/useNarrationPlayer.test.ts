import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextOrder, previousOrder, readPosition, readRate, writePosition } from "./useNarrationPlayer";
import { formatClock } from "../components/PlayerBar";

describe("chapter order among narrated chapters", () => {
  const ready = [1, 2, 5, 9];
  it("moves to the next / previous chapter that has audio, skipping gaps", () => {
    expect(nextOrder(ready, 2)).toBe(5);
    expect(nextOrder(ready, 9)).toBeUndefined();
    expect(previousOrder(ready, 5)).toBe(2);
    expect(previousOrder(ready, 1)).toBeUndefined();
    // From a chapter that has no audio itself.
    expect(nextOrder(ready, 3)).toBe(5);
    expect(previousOrder(ready, 3)).toBe(2);
  });
});

describe("saved position and speed", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("keeps positions per story and per library, and forgets on request", () => {
    writePosition("s1", false, { order: 3, time: 42.5 });
    expect(readPosition("s1", false)).toEqual({ order: 3, time: 42.5 });
    expect(readPosition("s1", true)).toBeUndefined();
    expect(readPosition("s2", false)).toBeUndefined();
    writePosition("s1", false, undefined);
    expect(readPosition("s1", false)).toBeUndefined();
  });

  it("ignores garbage and never throws when storage is unavailable", () => {
    store.set("narration-position:public:s1", "not json");
    expect(readPosition("s1", false)).toBeUndefined();
    store.set("narration-rate", "7");
    expect(readRate()).toBe(1);
    store.set("narration-rate", "1.5");
    expect(readRate()).toBe(1.5);

    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPosition("s1", false)).toBeUndefined();
    expect(readRate()).toBe(1);
    expect(() => writePosition("s1", false, { order: 1, time: 0 })).not.toThrow();
  });
});

describe("formatClock", () => {
  it.each([
    [0, "0:00"],
    [59.9, "0:59"],
    [61, "1:01"],
    [3725, "1:02:05"],
  ])("%d → %s", (seconds, text) => {
    expect(formatClock(seconds)).toBe(text);
  });
});
