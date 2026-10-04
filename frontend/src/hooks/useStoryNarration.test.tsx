// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReactNode } from "react";
import { LangProvider } from "../i18n";
import { StoredStory } from "../types";

const m = vi.hoisted(() => ({
  useNarration: vi.fn(),
  player: {} as Record<string, unknown>,
  readPosition: vi.fn(),
  vault: { active: false },
}));
vi.mock("./useNarration", () => ({ useNarration: m.useNarration }));
vi.mock("./narrationPlayer", () => ({
  useNarrationPlayer: () => m.player,
  readPosition: m.readPosition,
}));
vi.mock("../vault", () => ({ useVault: () => m.vault }));

import { useStoryNarration } from "./useStoryNarration";

const story = {
  id: "s1",
  title: "Story",
  language: "vi",
  updatedAt: "u1",
  chapters: [
    { order: 1, title: "One" },
    { order: 2, title: "" },
    { order: 3, title: "Three" },
  ],
} as unknown as StoredStory;

const state = (chapters: Record<number, "ready" | "missing">) => ({
  state: { narratable: true, chapters, bytes: 0, running: null },
});

const wrapper = ({ children }: { children: ReactNode }) => <LangProvider>{children}</LangProvider>;

beforeEach(() => {
  localStorage.setItem("lang", "en");
  m.useNarration.mockReset().mockReturnValue(state({ 1: "ready", 2: "missing", 3: "ready" }));
  m.readPosition.mockReset().mockReturnValue(undefined);
  m.vault.active = false;
  Object.assign(m.player, {
    storyId: null,
    order: null,
    updateQueue: vi.fn(),
    toggle: vi.fn(),
    play: vi.fn(),
  });
});

describe("useStoryNarration", () => {
  it("treats Vietnamese (or unset) language as narratable and passes it to useNarration", () => {
    renderHook(() => useStoryNarration(story, "Book", undefined));
    expect(m.useNarration).toHaveBeenCalledWith("s1", true, "u1");
    renderHook(() => useStoryNarration({ ...story, language: "" }, "Book", undefined));
    expect(m.useNarration).toHaveBeenLastCalledWith("s1", true, "u1");
  });

  it("is not narratable for other languages", () => {
    const { result } = renderHook(() => useStoryNarration({ ...story, language: "en" }, "Book", undefined));
    expect(result.current.narratable).toBe(false);
    expect(m.useNarration).toHaveBeenCalledWith("s1", false, "u1");
  });

  it("derives ready orders, count and the queue", () => {
    const { result } = renderHook(() => useStoryNarration(story, "Book", "c.jpg"), { wrapper });
    expect(result.current.narratedOrders).toEqual([1, 3]);
    expect(result.current.narratedCount).toBe(2);
    expect(result.current.queue).toEqual({
      storyId: "s1",
      storyTitle: "Book",
      orders: [1, 3],
      titles: { 1: "One", 2: "Chapter 2", 3: "Three" },
      coverUrl: "c.jpg",
    });
  });

  it("falls back to the story title when the book title is empty", () => {
    const { result } = renderHook(() => useStoryNarration(story, "", undefined));
    expect(result.current.queue.storyTitle).toBe("Story");
  });

  it("pushes the queue to the player only once narration has loaded", () => {
    m.useNarration.mockReturnValue({ state: null });
    renderHook(() => useStoryNarration(story, "Book", undefined));
    expect(m.player.updateQueue).not.toHaveBeenCalled();
    m.useNarration.mockReturnValue(state({ 1: "ready" }));
    renderHook(() => useStoryNarration(story, "Book", undefined));
    expect(m.player.updateQueue).toHaveBeenCalledWith(expect.objectContaining({ orders: [1] }));
  });

  it("playChapter toggles the playing chapter, otherwise plays it from the queue", () => {
    Object.assign(m.player, { storyId: "s1", order: 1 });
    const { result } = renderHook(() => useStoryNarration(story, "Book", undefined));
    result.current.playChapter(1);
    expect(m.player.toggle).toHaveBeenCalled();
    result.current.playChapter(3);
    expect(m.player.play).toHaveBeenCalledWith(result.current.queue, 3);
  });

  it("offers a resume position only for a narrated chapter while this story is not loaded", () => {
    m.readPosition.mockReturnValue({ order: 3, time: 10 });
    const { result } = renderHook(() => useStoryNarration(story, "Book", undefined));
    expect(result.current.resumeListen).toEqual({ order: 3, time: 10 });
    expect(m.readPosition).toHaveBeenCalledWith("s1", false);

    m.readPosition.mockReturnValue({ order: 2, time: 10 });
    expect(renderHook(() => useStoryNarration(story, "Book", undefined)).result.current.resumeListen).toBeUndefined();

    m.readPosition.mockReturnValue({ order: 3, time: 10 });
    m.player.storyId = "s1";
    expect(renderHook(() => useStoryNarration(story, "Book", undefined)).result.current.resumeListen).toBeUndefined();
  });
});
