// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { currentLang, translate } from ".";
import { DEFAULT_LANG, LOCALES } from "./locales";

beforeEach(() => localStorage.clear());

describe("translate", () => {
  it("returns the key when no locale has it", () => {
    expect(translate("en", "zz no such key")).toBe("zz no such key");
  });

  it("falls back to the key for a non-English locale missing the entry", () => {
    expect(translate("vi", "zz no such key")).toBe("zz no such key");
  });

  it("fills {name} placeholders and leaves unknown ones", () => {
    expect(translate("en", "Hi {name}, {other}", { name: "A" })).toBe("Hi A, {other}");
    expect(translate("en", "n={n}", { n: 0 })).toBe("n=0");
  });

  it("uses a locale's own message", () => {
    const [key, value] = Object.entries(LOCALES.vi.messages).find(([k, v]) => k !== v && !k.includes("{"))!;
    expect(translate("vi", key)).toBe(value);
  });
});

describe("currentLang", () => {
  it("defaults when nothing is stored or the value is unknown", () => {
    expect(currentLang()).toBe(DEFAULT_LANG);
    localStorage.setItem("lang", "klingon");
    expect(currentLang()).toBe(DEFAULT_LANG);
  });

  it("reads a stored language", () => {
    localStorage.setItem("lang", "vi");
    expect(currentLang()).toBe("vi");
  });
});
