import { describe, expect, it } from "vitest";
import { KeyInput, chatKeyAction } from "./keys";

function key(input: Partial<KeyInput>): KeyInput {
  return { key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...input };
}

describe("chatKeyAction", () => {
  it("opens the command list with F1 and Ctrl/Cmd+K", () => {
    expect(chatKeyAction(key({ key: "F1" }), false)).toBe("palette");
    expect(chatKeyAction(key({ key: "F1" }), true)).toBe("palette");
    expect(chatKeyAction(key({ key: "k", code: "KeyK", ctrlKey: true }), true)).toBe("palette");
    expect(chatKeyAction(key({ key: "k", code: "KeyK", metaKey: true }), false)).toBe("palette");
    // Another layout: the physical K key.
    expect(chatKeyAction(key({ key: "л", code: "KeyK", ctrlKey: true }), false)).toBe("palette");
    expect(chatKeyAction(key({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(chatKeyAction(key({ key: "F1", ctrlKey: true }), false)).toBeNull();
  });

  it("moves between threads with Alt+arrows, even while typing", () => {
    expect(chatKeyAction(key({ key: "ArrowDown", altKey: true }), true)).toBe("next");
    expect(chatKeyAction(key({ key: "ArrowUp", altKey: true }), false)).toBe("previous");
    expect(chatKeyAction(key({ key: "ArrowDown" }), false)).toBeNull();
    expect(chatKeyAction(key({ key: "ArrowDown", altKey: true, ctrlKey: true }), false)).toBeNull();
  });

  it("takes [ and ] only outside text fields", () => {
    expect(chatKeyAction(key({ key: "]" }), false)).toBe("next");
    expect(chatKeyAction(key({ key: "[" }), false)).toBe("previous");
    expect(chatKeyAction(key({ key: "]" }), true)).toBeNull();
    expect(chatKeyAction(key({ key: "]", ctrlKey: true }), false)).toBeNull();
  });

  it("leaves the boss key and everything else alone", () => {
    expect(chatKeyAction(key({ key: "`", code: "Backquote" }), false)).toBeNull();
    expect(chatKeyAction(key({ key: "a", code: "KeyA" }), false)).toBeNull();
  });
});
