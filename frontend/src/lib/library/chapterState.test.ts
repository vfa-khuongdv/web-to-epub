import { describe, expect, it } from "vitest";
import { StoredChapter } from "../../types";
import { toChapterState } from "./chapterState";

const t = (key: string) => key;

describe("toChapterState", () => {
  it("turns a finished chapter into its blocks", () => {
    const chapter: StoredChapter = {
      order: 3,
      url: "https://x.test/3",
      title: "Ba",
      status: "done",
      blocks: [{ type: "paragraph", text: "hi" }],
      spellChecked: true,
    };
    expect(toChapterState(chapter, 2, t)).toEqual({
      id: "stored-3",
      order: 3,
      data: { sourceUrl: "https://x.test/3", title: "Ba", blocks: chapter.blocks },
      title: "Ba",
      retrying: false,
      version: 2,
      retriedOnce: false,
      spellChecked: true,
    });
  });

  it("has no blocks for a done chapter stored without any, and spellChecked defaults to false", () => {
    const state = toChapterState({ order: 1, url: "u", title: "T", status: "done" }, 0, t);
    expect(state.data.blocks).toEqual([]);
    expect(state.spellChecked).toBe(false);
  });

  it("carries the error and kind of a failed chapter, marked as already retried", () => {
    const state = toChapterState(
      { order: 1, url: "u", title: "T", status: "error", error: "boom", errorKind: "locked" },
      0,
      t
    );
    expect(state.data).toEqual({ sourceUrl: "u", title: "T", blocks: [], error: "boom", errorKind: "locked" });
    expect(state.retriedOnce).toBe(true);
  });

  it("falls back to a translated 'Unknown error' when a failed chapter has no message", () => {
    const state = toChapterState({ order: 1, url: "u", title: "T", status: "error" }, 0, (k) => `vi:${k}`);
    expect(state.data.error).toBe("vi:Unknown error");
  });
});
