import { describe, expect, it } from "vitest";
import { DEFAULT_LANG, LANGUAGES, LOCALES } from "./locales";
import { en } from "./locales/en";

// One file per language, each covering exactly the source language's keys: a
// missing translation would silently fall back to English, and a stale key is a
// string nobody can reach. Placeholders must survive translation too — dropping
// `{count}` turns "3 errors" into a sentence with a hole in it.
const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");

describe("placeholders helper", () => {
  const cases: { name: string; key: string; value: string; equal: boolean }[] = [
    { name: "equal placeholder sets match", key: "{a}", value: "{a}", equal: true },
    { name: "a dropped placeholder is a mismatch", key: "{a}", value: "{a} {b}", equal: false },
    { name: "an extra placeholder is a mismatch", key: "{a} {b}", value: "{a}", equal: false },
    { name: "a duplicated placeholder is a mismatch", key: "{a}{a}", value: "{a}", equal: false },
    // Reordering must stay equal: translate() substitutes by name, not position.
    { name: "reordered placeholders still match", key: "{a} {b}", value: "{b} {a}", equal: true },
  ];

  for (const { name, key, value, equal } of cases) {
    it(name, () => {
      expect(placeholders(value) === placeholders(key)).toBe(equal);
    });
  }
});

describe("locale files", () => {
  const sourceKeys = Object.keys(en).sort();

  for (const [code, locale] of Object.entries(LOCALES)) {
    // `en` is the baseline this comparison reads, so the assertion is a no-op
    // for it; every other locale is checked against it.
    it(`${code} covers exactly the source keys`, () => {
      expect(Object.keys(locale.messages).sort()).toEqual(sourceKeys);
    });

    it(`${code} keeps every placeholder`, () => {
      const mismatched = Object.entries(locale.messages)
        .filter(([key, value]) => placeholders(value) !== placeholders(key))
        .map(([key, value]) => `${key} → ${value}`);
      expect(mismatched).toEqual([]);
    });
  }

  it("uses only {word} placeholders", () => {
    // translate() (index.tsx:17) substitutes `\{(\w+)\}` only, so any other
    // brace would survive to the screen. Strip valid placeholders and assert
    // nothing is left over.
    const strayBraces: string[] = [];
    for (const [code, locale] of Object.entries(LOCALES)) {
      for (const [key, value] of Object.entries(locale.messages)) {
        for (const text of [key, value]) {
          if (/[{}]/.test(text.replace(/\{\w+\}/g, ""))) strayBraces.push(`${code}: ${text}`);
        }
      }
    }
    expect(strayBraces).toEqual([]);
  });
});

describe("locale registry", () => {
  it("registers DEFAULT_LANG and lists every locale in LANGUAGES", () => {
    expect(Object.keys(LOCALES)).toContain(DEFAULT_LANG);
    expect(LANGUAGES.map((locale) => locale.code).sort()).toEqual(Object.keys(LOCALES).sort());
  });

  it("has one file per registered locale, and no orphan files", () => {
    const files = Object.keys(import.meta.glob("./locales/*.ts"))
      .map((path) => path.split("/").pop() ?? "")
      .filter((file) => file !== "index.ts")
      .map((file) => file.replace(/\.ts$/, ""))
      .sort();
    expect(files).toEqual(Object.keys(LOCALES).sort());
  });
});
