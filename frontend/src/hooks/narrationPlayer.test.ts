import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handlesOwnKeys,
  nextOrder,
  previousOrder,
  readMusicEnabled,
  readMusicTrack,
  readPosition,
  readRate,
  readVolume,
  upNextOrders,
  writePosition,
} from "./narrationPlayer";
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

describe("playback volume", () => {
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

  it("defaults to full volume and ignores values outside 0..1", () => {
    expect(readVolume()).toBe(1);
    store.set("narration-volume", "0.4");
    expect(readVolume()).toBe(0.4);
    store.set("narration-volume", "0");
    expect(readVolume()).toBe(0);
    store.set("narration-volume", "7");
    expect(readVolume()).toBe(1);
    store.set("narration-volume", "not a number");
    expect(readVolume()).toBe(1);
  });

  it("never throws when storage is blocked", () => {
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
    expect(readVolume()).toBe(1);
  });
});

describe("background music defaults", () => {
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

  // The app ships tracks to play, so music is on until the user says otherwise — and
  // "otherwise" has to be what is stored for it to stay off.
  it("plays by default, and only an explicit off turns it off", () => {
    expect(readMusicEnabled()).toBe(true);
    store.set("narration-music-enabled", "0");
    expect(readMusicEnabled()).toBe(false);
    store.set("narration-music-enabled", "1");
    expect(readMusicEnabled()).toBe(true);
  });

  it("has no track until one is picked, and remembers None as a pick", () => {
    expect(readMusicTrack()).toBeNull();
    store.set("narration-music", "abc");
    expect(readMusicTrack()).toBe("abc");
    // How "None" is stored: not null, or the app's default would come back every load.
    store.set("narration-music", "none");
    expect(readMusicTrack()).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readMusicEnabled()).toBe(true);
    expect(readMusicTrack()).toBeNull();
  });
});

describe("next up", () => {
  it("is the current chapter and the narrated ones after it, in order", () => {
    expect(upNextOrders([1, 2, 5, 9], 2)).toEqual([2, 5, 9]);
    // A current chapter without audio itself: still everything from there on.
    expect(upNextOrders([1, 2, 5, 9], 3)).toEqual([5, 9]);
    expect(upNextOrders([1, 2, 5, 9], 9)).toEqual([9]);
    expect(upNextOrders([], 1)).toEqual([]);
  });
});

describe("shortcut guard", () => {
  it("leaves the key to the element that already uses it", () => {
    expect(handlesOwnKeys({ tagName: "INPUT" })).toBe(true);
    expect(handlesOwnKeys({ tagName: "textarea" })).toBe(true);
    expect(handlesOwnKeys({ tagName: "select" })).toBe(true);
    expect(handlesOwnKeys({ tagName: "BUTTON" })).toBe(true);
    expect(handlesOwnKeys({ tagName: "A" })).toBe(true);
    expect(handlesOwnKeys({ isContentEditable: true })).toBe(true);
    expect(handlesOwnKeys({ tagName: "DIV" })).toBe(false);
    expect(handlesOwnKeys(null)).toBe(false);
  });
});
