import { describe, expect, it } from "vitest";
import { LOCALES } from "./locales";
import { en } from "./locales/en";

// One file per language, each covering exactly the source language's keys: a
// missing translation would silently fall back to English, and a stale key is a
// string nobody can reach. Placeholders must survive translation too — dropping
// `{count}` turns "3 errors" into a sentence with a hole in it.
const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");

describe("locale files", () => {
  const sourceKeys = Object.keys(en).sort();

  for (const [code, locale] of Object.entries(LOCALES)) {
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
});
