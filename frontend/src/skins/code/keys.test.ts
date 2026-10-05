import { describe, expect, it } from "vitest";
import { KeyInput, globalAction, shortcut } from "./keys";

const press = (key: string, code: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("globalAction", () => {
  const cases: { name: string; event: KeyInput; action: ReturnType<typeof globalAction> }[] = [
    { name: "F1 opens the palette", event: press("F1", "F1"), action: "palette" },
    { name: "Ctrl+Shift+P opens the palette", event: press("P", "KeyP", { ctrlKey: true, shiftKey: true }), action: "palette" },
    { name: "Cmd+Shift+P opens the palette", event: press("p", "KeyP", { metaKey: true, shiftKey: true }), action: "palette" },
    { name: "Ctrl+P is quick open", event: press("p", "KeyP", { ctrlKey: true }), action: "quickOpen" },
    { name: "Cmd+B toggles the side bar", event: press("b", "KeyB", { metaKey: true }), action: "toggleSidebar" },
    { name: "Ctrl+J toggles the panel", event: press("j", "KeyJ", { ctrlKey: true }), action: "togglePanel" },
    { name: "Ctrl+` toggles the panel", event: press("`", "Backquote", { ctrlKey: true }), action: "togglePanel" },
    { name: "Cmd+` is left to the system", event: press("`", "Backquote", { metaKey: true }), action: null },
    { name: "a bare backquote is the boss key, not ours", event: press("`", "Backquote"), action: null },
    { name: "Ctrl+W closes the tab", event: press("w", "KeyW", { ctrlKey: true }), action: "closeTab" },
    { name: "Ctrl+Shift+E shows the explorer", event: press("E", "KeyE", { ctrlKey: true, shiftKey: true }), action: "showExplorer" },
    { name: "Ctrl+Shift+F shows search", event: press("F", "KeyF", { ctrlKey: true, shiftKey: true }), action: "showSearch" },
    { name: "a plain letter is not a shortcut", event: press("b", "KeyB"), action: null },
    { name: "Alt combinations are left alone", event: press("b", "KeyB", { ctrlKey: true, altKey: true }), action: null },
    { name: "Ctrl+F1 is not the palette", event: press("F1", "F1", { ctrlKey: true }), action: null },
    { name: "the physical key wins over the character", event: press("и", "KeyB", { ctrlKey: true }), action: "toggleSidebar" },
    { name: "the character is used when there is no code", event: press("j", "", { ctrlKey: true }), action: "togglePanel" },
  ];
  for (const { name, event, action } of cases) {
    it(name, () => expect(globalAction(event)).toBe(action));
  }
});

describe("shortcut", () => {
  it("prints Ctrl elsewhere", () => expect(shortcut("Mod+Shift+P", false)).toBe("Ctrl+Shift+P"));
  it("prints Mac symbols in the Mac order", () => expect(shortcut("Mod+Shift+P", true)).toBe("⇧⌘P"));
  it("keeps a plain key", () => expect(shortcut("F1", true)).toBe("F1"));
  it("keeps Ctrl on a Mac when Ctrl is meant", () => expect(shortcut("Ctrl+`", true)).toBe("⌃`"));
});
