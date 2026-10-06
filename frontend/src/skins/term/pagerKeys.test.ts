import { describe, expect, it } from "vitest";
import { clampTop, colonKey, maxTop, pagerKey, pagerStatus, wheelRows } from "./pagerKeys";

const key = (name: string, ctrl = false) => ({ key: name, ctrlKey: ctrl, metaKey: false, altKey: false });
const VIEW = { top: 40, height: 40, total: 220 };

describe("pagerKey", () => {
  it("moves a screen, half a screen and a line, both ways", () => {
    expect(pagerKey(key(" "), VIEW)).toEqual({ type: "move", top: 80 });
    expect(pagerKey(key("PageDown"), VIEW)).toEqual({ type: "move", top: 80 });
    expect(pagerKey(key("f", true), VIEW)).toEqual({ type: "move", top: 80 });
    expect(pagerKey(key("b"), VIEW)).toEqual({ type: "move", top: 0 });
    expect(pagerKey(key("d"), VIEW)).toEqual({ type: "move", top: 60 });
    expect(pagerKey(key("u", true), VIEW)).toEqual({ type: "move", top: 20 });
    expect(pagerKey(key("j"), VIEW)).toEqual({ type: "move", top: 41 });
    expect(pagerKey(key("ArrowUp"), VIEW)).toEqual({ type: "move", top: 39 });
  });

  it("goes to either end without passing it", () => {
    expect(pagerKey(key("g"), VIEW)).toEqual({ type: "move", top: 0 });
    expect(pagerKey(key("G"), VIEW)).toEqual({ type: "move", top: 180 });
    expect(pagerKey(key(" "), { ...VIEW, top: 170 })).toEqual({ type: "move", top: 180 });
  });

  it("maps files, search, quitting and help", () => {
    expect(pagerKey(key("]"), VIEW)).toEqual({ type: "file", direction: 1 });
    expect(pagerKey(key("["), VIEW)).toEqual({ type: "file", direction: -1 });
    expect(pagerKey(key("/"), VIEW)).toEqual({ type: "search", direction: 1 });
    expect(pagerKey(key("?"), VIEW)).toEqual({ type: "search", direction: -1 });
    expect(pagerKey(key("N"), VIEW)).toEqual({ type: "again", reverse: true });
    expect(pagerKey(key("q"), VIEW)).toEqual({ type: "quit" });
    expect(pagerKey(key(":"), VIEW)).toEqual({ type: "colon" });
    expect(pagerKey(key("h"), VIEW)).toEqual({ type: "help" });
  });

  it("leaves other keys and Cmd/Alt chords alone", () => {
    expect(pagerKey(key("x"), VIEW)).toEqual({ type: "none" });
    expect(pagerKey({ ...key("f"), metaKey: true }, VIEW)).toEqual({ type: "none" });
    expect(pagerKey(key("=", true), VIEW)).toEqual({ type: "none" });
  });

  it("reads the key after a colon as less does", () => {
    expect(colonKey("n")).toEqual({ type: "file", direction: 1 });
    expect(colonKey("p")).toEqual({ type: "file", direction: -1 });
    expect(colonKey("q")).toEqual({ type: "quit" });
    expect(colonKey("z")).toEqual({ type: "none" });
  });
});

describe("bounds", () => {
  it("keeps the end of the file on the bottom line", () => {
    expect(maxTop({ height: 40, total: 220 })).toBe(180);
    expect(maxTop({ height: 40, total: 10 })).toBe(0);
    expect(clampTop(-5, { height: 40, total: 220 })).toBe(0);
    expect(clampTop(500, { height: 40, total: 220 })).toBe(180);
  });

  it("turns wheel deltas into whole rows, keeping the rest", () => {
    expect(wheelRows(50, 0, 20, 0)).toEqual({ rows: 2, carry: 0.5 });
    expect(wheelRows(10, 0, 20, 0.5)).toEqual({ rows: 1, carry: 0 });
    expect(wheelRows(-3, 1, 20, 0)).toEqual({ rows: -3, carry: 0 });
  });
});

describe("pagerStatus", () => {
  it("prints less's long prompt", () => {
    expect(pagerStatus({ name: "ch-0012.md", view: VIEW })).toBe("ch-0012.md lines 41-80/220 36%");
    expect(pagerStatus({ name: "ch-0012.md", view: { ...VIEW, top: 180 } })).toBe("ch-0012.md lines 181-220/220 (END)");
    expect(pagerStatus({ name: "a.md", view: { top: 0, height: 40, total: 12 } })).toBe("a.md lines 1-12/12 (END)");
    expect(pagerStatus({ name: "a.md", view: { top: 0, height: 40, total: 0 } })).toBe("a.md (END)");
  });

  it("says which file of the folder was just opened", () => {
    expect(pagerStatus({ name: "a.md", view: VIEW, fileIndex: { at: 3, of: 12 } })).toBe("a.md (file 3 of 12) lines 41-80/220 36%");
  });
});
