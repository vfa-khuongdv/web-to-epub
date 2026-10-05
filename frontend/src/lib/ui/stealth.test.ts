// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STEALTH,
  GESTURE_GRACE_MS,
  KeyLike,
  blurIsOwnDialog,
  isBossKey,
  isTextEntry,
  readStealth,
  saveStealth,
} from "./stealth";

const key = (overrides: Partial<KeyLike>): KeyLike => ({
  code: "Backquote",
  key: "`",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...overrides,
});

describe("isBossKey", () => {
  const cases: { name: string; event: KeyLike; typing: boolean; expected: boolean }[] = [
    { name: "backquote outside a text field hides", event: key({}), typing: false, expected: true },
    // A dead key (Option+` on a Mac, many non-US layouts) still comes from the same physical key.
    { name: "a dead key on the same physical key hides", event: key({ key: "Dead" }), typing: false, expected: true },
    { name: "shift+backquote (~) hides too", event: key({ key: "~", shiftKey: true }), typing: false, expected: true },
    { name: "the key types while writing", event: key({}), typing: true, expected: false },
    { name: "Alt+` hides from inside a text field", event: key({ altKey: true }), typing: true, expected: true },
    // Ctrl+` belongs to the code skin's panel (and real editors' terminals).
    { name: "Ctrl+` is left alone", event: key({ ctrlKey: true }), typing: false, expected: false },
    { name: "Cmd+` (switch window on a Mac) is left alone", event: key({ metaKey: true }), typing: false, expected: false },
    { name: "Esc is not the boss key", event: key({ code: "Escape", key: "Escape" }), typing: false, expected: false },
  ];
  for (const { name, event, typing, expected } of cases) {
    it(name, () => expect(isBossKey(event, typing)).toBe(expected));
  }
});

describe("isTextEntry", () => {
  const make = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild;
  };

  it("counts text inputs, textareas, selects and editable regions", () => {
    expect(isTextEntry(make('<input type="text">'))).toBe(true);
    expect(isTextEntry(make("<input>"))).toBe(true);
    expect(isTextEntry(make('<input type="search">'))).toBe(true);
    expect(isTextEntry(make("<textarea></textarea>"))).toBe(true);
    expect(isTextEntry(make("<select></select>"))).toBe(true);
    const editable = make('<div contenteditable="true"></div>') as HTMLElement;
    // jsdom does not compute isContentEditable from the attribute.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTextEntry(editable)).toBe(true);
  });

  it("does not count a field nobody can type into, or one that hands the key to the boss key", () => {
    expect(isTextEntry(make("<input readonly>"))).toBe(false);
    expect(isTextEntry(make("<input disabled>"))).toBe(false);
    expect(isTextEntry(make("<textarea readonly></textarea>"))).toBe(false);
    expect(isTextEntry(make("<input data-boss-key>"))).toBe(false);
  });

  it("does not count buttons, checkboxes or plain elements", () => {
    expect(isTextEntry(make('<input type="checkbox">'))).toBe(false);
    expect(isTextEntry(make('<input type="range">'))).toBe(false);
    expect(isTextEntry(make("<button></button>"))).toBe(false);
    expect(isTextEntry(make("<div></div>"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(window)).toBe(false);
  });
});

describe("blurIsOwnDialog", () => {
  it("treats a blur right after a click as the app opening a dialog of its own", () => {
    expect(blurIsOwnDialog(1000, 1000 + GESTURE_GRACE_MS - 1)).toBe(true);
  });

  it("treats a blur long after any gesture as leaving the app", () => {
    expect(blurIsOwnDialog(1000, 1000 + GESTURE_GRACE_MS)).toBe(false);
    expect(blurIsOwnDialog(0, 100_000)).toBe(false);
  });
});

describe("stealth preferences", () => {
  afterEach(() => localStorage.clear());

  it("defaults to everything off", () => {
    expect(readStealth()).toEqual(DEFAULT_STEALTH);
  });

  it("round-trips through localStorage", () => {
    saveStealth({ hideOnBlur: true, neutralNames: true, globalKey: false });
    expect(readStealth()).toEqual({ hideOnBlur: true, neutralNames: true, globalKey: false });
  });

  it("reads only real booleans from a damaged entry", () => {
    localStorage.setItem("stealth", JSON.stringify({ hideOnBlur: "yes", neutralNames: 1, globalKey: true }));
    expect(readStealth()).toEqual({ hideOnBlur: false, neutralNames: false, globalKey: true });
    localStorage.setItem("stealth", "{not json");
    expect(readStealth()).toEqual(DEFAULT_STEALTH);
  });
});
