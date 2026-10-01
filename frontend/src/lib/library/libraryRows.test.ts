import { describe, expect, it } from "vitest";
import type { StoryRow } from "./libraryRows";
import { compareRows, crawlStatus, fold } from "./libraryRows";

// Keys are the English source text, so an identity translator reads like the UI.
const t = (key: string, params?: Record<string, string | number>) =>
  key.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name]));

const row = (over: Partial<StoryRow>): StoryRow =>
  ({ title: "", site: "", updatedAt: "", chapterCount: 0, done: 0, errors: 0, remaining: 0, ...over }) as StoryRow;

describe("fold", () => {
  it("strips diacritics so typing 'van' finds 'Văn'", () => {
    expect(fold("Văn Đình")).toBe("van dinh");
  });
});

describe("compareRows", () => {
  it("sorts text with the Vietnamese collation, dates as ISO strings, counts numerically", () => {
    expect(compareRows(row({ title: "A" }), row({ title: "B" }), "title")).toBeLessThan(0);
    expect(compareRows(row({ updatedAt: "2026-02-01" }), row({ updatedAt: "2026-01-01" }), "updatedAt")).toBeGreaterThan(0);
    expect(compareRows(row({ done: 2 }), row({ done: 10 }), "done")).toBeLessThan(0);
  });
});

describe("crawlStatus", () => {
  it("prefers a running crawl, then new chapters, then what is pending", () => {
    const crawling = { cursor: 2, total: 5 } as never;
    expect(crawlStatus(10, 0, 0, 3, crawling, t as never)).toEqual({ state: "running", label: "Crawling 2/5" });
    expect(crawlStatus(10, 0, 0, 3, undefined, t as never)).toEqual({ state: "new", label: "3 new chapters" });
    expect(crawlStatus(10, 4, 1, 0, undefined, t as never)).toEqual({ state: "pending", label: "5 chapters pending" });
  });

  it("reports errors once nothing is left, and complete otherwise", () => {
    expect(crawlStatus(10, 8, 2, 0, undefined, t as never)).toEqual({ state: "error", label: "Done · 2 errors" });
    expect(crawlStatus(10, 10, 0, 0, undefined, t as never)).toEqual({ state: "done", label: "Crawl complete" });
  });
});
