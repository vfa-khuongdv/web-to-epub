// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_CYCLE, applyTheme, readTheme, saveTheme } from "./theme";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("theme storage", () => {
  it("defaults to system", () => expect(readTheme()).toBe("system"));

  it("round-trips light and dark", () => {
    saveTheme("dark");
    expect(readTheme()).toBe("dark");
    saveTheme("light");
    expect(readTheme()).toBe("light");
  });

  it("saving system removes the entry", () => {
    saveTheme("dark");
    saveTheme("system");
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("treats an unknown stored value as system", () => {
    localStorage.setItem("theme", "purple");
    expect(readTheme()).toBe("system");
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTheme()).toBe("system");
    expect(() => saveTheme("dark")).not.toThrow();
  });
});

describe("applyTheme", () => {
  const mockDark = (matches: boolean) =>
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches })));
  afterEach(() => vi.unstubAllGlobals());

  it("sets explicit themes regardless of the system", () => {
    mockDark(true);
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows the system preference for system", () => {
    mockDark(true);
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    mockDark(false);
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

it("cycles auto, light, dark", () => expect(THEME_CYCLE).toEqual(["system", "light", "dark"]));
