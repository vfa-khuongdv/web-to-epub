import { describe, expect, it } from "vitest";
import {
  Editors,
  NO_EDITORS,
  activeTab,
  adjacentOrder,
  closeTab,
  keepStories,
  openTab,
  replaceActive,
  tabKey,
} from "./tabs";

const keys = (editors: Editors) => editors.tabs.map(tabKey);

describe("openTab", () => {
  it("opens the first tab", () => {
    const next = openTab(NO_EDITORS, { storyId: "a", order: 1 });
    expect(keys(next)).toEqual(["a:1"]);
    expect(next.active).toBe("a:1");
  });

  it("adds right of the active tab", () => {
    let editors = openTab(NO_EDITORS, { storyId: "a", order: 1 });
    editors = openTab(editors, { storyId: "a", order: 2 });
    editors = { ...editors, active: "a:1" };
    editors = openTab(editors, { storyId: "a", order: 3 });
    expect(keys(editors)).toEqual(["a:1", "a:3", "a:2"]);
    expect(editors.active).toBe("a:3");
  });

  it("shows an open file instead of opening it twice", () => {
    let editors = openTab(NO_EDITORS, { storyId: "a", order: 1 });
    editors = openTab(editors, { storyId: "a", order: 2 });
    const again = openTab(editors, { storyId: "a", order: 1 });
    expect(keys(again)).toEqual(["a:1", "a:2"]);
    expect(again.active).toBe("a:1");
  });

  it("keeps at most `max` tabs, dropping the leftmost one not in use", () => {
    let editors = NO_EDITORS;
    for (let order = 1; order <= 3; order++) editors = openTab(editors, { storyId: "a", order }, 3);
    editors = { ...editors, active: "a:1" };
    editors = openTab(editors, { storyId: "a", order: 4 }, 3);
    expect(keys(editors)).toEqual(["a:1", "a:4", "a:3"]);
    expect(editors.active).toBe("a:4");
  });
});

describe("replaceActive", () => {
  it("turns the active tab into the next chapter", () => {
    let editors = openTab(NO_EDITORS, { storyId: "a", order: 1 });
    editors = openTab(editors, { storyId: "b", order: 7 });
    editors = { ...editors, active: "a:1" };
    const next = replaceActive(editors, { storyId: "a", order: 2 });
    expect(keys(next)).toEqual(["a:2", "b:7"]);
    expect(next.active).toBe("a:2");
  });

  it("shows the chapter's own tab when it has one", () => {
    let editors = openTab(NO_EDITORS, { storyId: "a", order: 1 });
    editors = openTab(editors, { storyId: "a", order: 2 });
    editors = { ...editors, active: "a:1" };
    const next = replaceActive(editors, { storyId: "a", order: 2 });
    expect(keys(next)).toEqual(["a:1", "a:2"]);
    expect(next.active).toBe("a:2");
  });

  it("opens a tab when none is active", () => {
    const next = replaceActive(NO_EDITORS, { storyId: "a", order: 2 });
    expect(keys(next)).toEqual(["a:2"]);
  });
});

describe("closeTab", () => {
  const three = (active: string): Editors => ({
    tabs: [
      { storyId: "a", order: 1 },
      { storyId: "a", order: 2 },
      { storyId: "a", order: 3 },
    ],
    active,
  });

  it("shows the right neighbour after closing the active tab", () => {
    expect(closeTab(three("a:2"), "a:2").active).toBe("a:3");
  });

  it("shows the left neighbour when the last tab closes", () => {
    expect(closeTab(three("a:3"), "a:3").active).toBe("a:2");
  });

  it("keeps the active tab when another closes", () => {
    const next = closeTab(three("a:3"), "a:1");
    expect(keys(next)).toEqual(["a:2", "a:3"]);
    expect(next.active).toBe("a:3");
  });

  it("ends with no active tab", () => {
    expect(closeTab({ tabs: [{ storyId: "a", order: 1 }], active: "a:1" }, "a:1")).toEqual(NO_EDITORS);
  });

  it("ignores an unknown key", () => {
    const editors = three("a:1");
    expect(closeTab(editors, "zz:9")).toBe(editors);
  });
});

describe("keepStories", () => {
  it("drops tabs of stories that are gone", () => {
    const editors: Editors = {
      tabs: [
        { storyId: "a", order: 1 },
        { storyId: "b", order: 1 },
      ],
      active: "b:1",
    };
    const next = keepStories(editors, new Set(["a"]));
    expect(keys(next)).toEqual(["a:1"]);
    expect(next.active).toBe("a:1");
    expect(activeTab(next)).toEqual({ storyId: "a", order: 1 });
  });

  it("returns the same state when nothing is gone", () => {
    const editors: Editors = { tabs: [{ storyId: "a", order: 1 }], active: "a:1" };
    expect(keepStories(editors, new Set(["a"]))).toBe(editors);
  });
});

describe("adjacentOrder", () => {
  const chapters = [{ order: 1 }, { order: 2 }, { order: 5 }];
  it("finds the next chapter by list position, not by number", () => expect(adjacentOrder(chapters, 2, 1)).toBe(5));
  it("finds the previous chapter", () => expect(adjacentOrder(chapters, 5, -1)).toBe(2));
  it("stops at the ends", () => {
    expect(adjacentOrder(chapters, 5, 1)).toBeNull();
    expect(adjacentOrder(chapters, 1, -1)).toBeNull();
  });
  it("is null for an unknown chapter", () => expect(adjacentOrder(chapters, 9, 1)).toBeNull());
});
