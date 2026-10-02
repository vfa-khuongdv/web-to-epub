import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setLang, t } from "./lang";

afterEach(() => setLang(undefined));

describe("t / setLang", () => {
  it("defaults to English (returns the key)", () => {
    expect(t("url is required")).toBe("url is required");
  });

  it("translates to Vietnamese after setLang('vi')", () => {
    setLang("vi");
    expect(t("url is required")).toBe("url là bắt buộc");
  });

  it("falls back to English for unknown languages or undefined", () => {
    setLang("vi");
    setLang("fr");
    expect(t("url is required")).toBe("url is required");
    setLang("vi");
    setLang(undefined);
    expect(t("url is required")).toBe("url is required");
  });

  it("returns the key for a message with no entry, even in Vietnamese", () => {
    setLang("vi");
    expect(t("no such message")).toBe("no such message");
  });

  it("fills {placeholders} in both languages, numbers included", () => {
    expect(t("Could not extract main content from {url}", { url: "u" })).toBe("Could not extract main content from u");
    setLang("vi");
    const vi = t("Could not extract main content from {url}", { url: "u" });
    expect(vi).toContain("u");
    expect(vi).not.toContain("{url}");
    expect(t("n={n}", { n: 0 })).toBe("n=0");
  });

  it("leaves a placeholder without a value untouched", () => {
    expect(t("a {x} b {y}", { x: "1" })).toBe("a 1 b {y}");
  });
});

describe("vi table consistency", () => {
  const src = readFileSync(join(__dirname, "lang.ts"), "utf8");
  const body = src.slice(src.indexOf("const vi:"), src.indexOf("let current"));
  // entries: "key": "value" or key on one line and value on the next
  const entries = [...body.matchAll(/^\s*"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)].map(
    (m) => [JSON.parse(`"${m[1]}"`), JSON.parse(`"${m[2]}"`)] as [string, string]
  );
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it("parses a meaningful number of entries", () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it("every translation keeps exactly the placeholders of its key", () => {
    for (const [key, value] of entries) expect(placeholders(value), key).toEqual(placeholders(key));
  });

  it("no translation is empty and none equals its key by accident of whitespace", () => {
    for (const [key, value] of entries) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("has no duplicate keys", () => {
    const keys = entries.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
