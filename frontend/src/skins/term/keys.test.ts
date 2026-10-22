import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_SIZE, FONT_SIZES, stepFontSize, windowAction } from "./keys";

const press = (key: string, code: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("windowAction", () => {
  it("opens the palette with F1 and Ctrl/Cmd+Shift+P", () => {
    expect(windowAction(press("F1", "F1"))).toBe("palette");
    expect(windowAction(press("P", "KeyP", { ctrlKey: true, shiftKey: true }))).toBe("palette");
    expect(windowAction(press("p", "KeyP", { metaKey: true, shiftKey: true }))).toBe("palette");
    expect(windowAction(press("p", "KeyP", { ctrlKey: true }))).toBeNull();
  });

  it("zooms with Ctrl/Cmd and =, -, 0", () => {
    expect(windowAction(press("=", "Equal", { metaKey: true }))).toBe("zoomIn");
    expect(windowAction(press("+", "Equal", { ctrlKey: true, shiftKey: true }))).toBe("zoomIn");
    expect(windowAction(press("-", "Minus", { ctrlKey: true }))).toBe("zoomOut");
    expect(windowAction(press("0", "Digit0", { ctrlKey: true }))).toBe("zoomReset");
    expect(windowAction(press("=", "Equal"))).toBeNull();
  });

  it("leaves the boss key and plain typing alone", () => {
    expect(windowAction(press("`", "Backquote"))).toBeNull();
    expect(windowAction(press("a", "KeyA"))).toBeNull();
    expect(windowAction(press("F1", "F1", { altKey: true }))).toBeNull();
  });
});

describe("stepFontSize", () => {
  it("steps through the sizes and stops at the ends", () => {
    expect(stepFontSize(DEFAULT_FONT_SIZE, 1)).toBe(15);
    expect(stepFontSize(DEFAULT_FONT_SIZE, -1)).toBe(13);
    expect(stepFontSize(FONT_SIZES[0], -1)).toBe(FONT_SIZES[0]);
    expect(stepFontSize(FONT_SIZES[FONT_SIZES.length - 1], 1)).toBe(FONT_SIZES[FONT_SIZES.length - 1]);
    expect(stepFontSize(17, 1)).toBe(15);
  });
});
