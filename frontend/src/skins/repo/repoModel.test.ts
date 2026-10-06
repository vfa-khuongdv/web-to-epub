import { describe, expect, it } from "vitest";
import {
  DESCRIPTIONS,
  commitMessage,
  descriptionKey,
  fileStats,
  fileTime,
  firstVisible,
  formatSize,
  pageCount,
  pageItems,
  pageOf,
  pageSlice,
  pageTitle,
  rawRows,
  relativeTime,
  shortSha,
} from "./repoModel";

describe("paging", () => {
  it("counts at least one page", () => {
    expect(pageCount(0, 100)).toBe(1);
    expect(pageCount(100, 100)).toBe(1);
    expect(pageCount(1201, 100)).toBe(13);
  });

  it("slices a page, clamping one past the end", () => {
    const items = Array.from({ length: 250 }, (_, index) => index);
    expect(pageSlice(items, 1, 100)).toEqual(items.slice(100, 200));
    expect(pageSlice(items, 9, 100)).toEqual(items.slice(200));
    expect(pageOf(199, 100)).toBe(1);
  });

  it("draws the site's page links with gaps", () => {
    expect(pageItems(0, 1)).toEqual([0]);
    expect(pageItems(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(pageItems(8, 40)).toEqual([0, 1, "gap", 6, 7, 8, 9, 10, "gap", 38, 39]);
    // A gap never hides a single page.
    expect(pageItems(4, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("reads like the site", () => {
    expect(relativeTime(ago(10_000), now)).toBe("just now");
    expect(relativeTime(ago(60_000), now)).toBe("1 minute ago");
    expect(relativeTime(ago(5 * 60_000), now)).toBe("5 minutes ago");
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3 hours ago");
    expect(relativeTime(ago(26 * 3_600_000), now)).toBe("yesterday");
    expect(relativeTime(ago(4 * 86_400_000), now)).toBe("4 days ago");
    expect(relativeTime("2026-07-12T08:00:00Z", now)).toBe("on Jul 12");
    expect(relativeTime("2025-07-12T08:00:00Z", now)).toBe("on Jul 12, 2025");
  });

  it("gives nothing for an unreadable date", () => {
    expect(relativeTime("not a date", now)).toBe("");
    expect(relativeTime(undefined, now)).toBe("");
  });
});

describe("made-up commit details", () => {
  it("has a stable seven-digit hash", () => {
    expect(shortSha("story:12")).toMatch(/^[0-9a-f]{7}$/);
    expect(shortSha("story:12")).toBe(shortSha("story:12"));
    expect(shortSha("story:12")).not.toBe(shortSha("story:13"));
  });

  it("names the part, never a title, by the file's state", () => {
    expect(commitMessage(12, "done")).toMatch(/^docs: .* part-0012$/);
    expect(commitMessage(12, "pending")).toBe("chore: queue part-0012");
    expect(commitMessage(12, "running")).toBe("ci: sync part-0012");
    expect(commitMessage(12, "error")).toBe("ci: sync part-0012 (failed)");
  });

  it("dates earlier files earlier", () => {
    const updated = "2026-10-06T12:00:00.000Z";
    expect(fileTime(updated, 10, 10)).toBe(updated);
    expect(Date.parse(fileTime(updated, 1, 10))).toBeLessThan(Date.parse(fileTime(updated, 9, 10)));
  });

  it("picks a description for any position", () => {
    expect(DESCRIPTIONS).toContain(descriptionKey(0));
    expect(descriptionKey(DESCRIPTIONS.length)).toBe(descriptionKey(0));
    expect(DESCRIPTIONS).toContain(descriptionKey(-1));
  });
});

describe("pageTitle", () => {
  it("names the list, a repository, a section and a file", () => {
    expect(pageTitle({ repo: null })).toBe("Repositories");
    expect(pageTitle({ repo: "module-01", tab: "code" })).toBe("team/module-01");
    expect(pageTitle({ repo: "module-01", tab: "actions" })).toBe("Workflow runs · team/module-01");
    expect(pageTitle({ repo: "module-01", file: "part-0003.md" })).toBe("module-01/part-0003.md at main · team/module-01");
  });

  it("names a pull request and an issue the way the site does", () => {
    expect(pageTitle({ repo: "module-01", item: { kind: "pull", number: 482, title: "feat: a", author: "hoang-nm" } })).toBe(
      "feat: a by hoang-nm · Pull Request #482 · team/module-01"
    );
    expect(pageTitle({ repo: "module-01", item: { kind: "issue", number: 471, title: "Báo cáo", author: "lan-pt" } })).toBe(
      "Báo cáo · Issue #471 · team/module-01"
    );
  });
});

describe("a chapter as Markdown", () => {
  const lines = [
    { kind: "heading" as const, text: "Mở đầu" },
    { kind: "text" as const, text: "Đoạn một." },
    { kind: "media" as const, text: "[image: hình]" },
  ];

  it("puts a blank line between blocks and keeps the block index", () => {
    expect(rawRows(lines)).toEqual([
      { number: 1, text: "## Mở đầu", line: 0 },
      { number: 2, text: "", line: null },
      { number: 3, text: "Đoạn một.", line: 1 },
      { number: 4, text: "", line: null },
      { number: 5, text: "[image: hình]", line: 2 },
    ]);
    expect(rawRows([])).toEqual([]);
  });

  it("counts lines, code lines and UTF-8 bytes", () => {
    const stats = fileStats(rawRows(lines));
    expect(stats.lines).toBe(5);
    expect(stats.loc).toBe(3);
    const source = "## Mở đầu\n\nĐoạn một.\n\n[image: hình]";
    expect(stats.bytes).toBe(new TextEncoder().encode(source).length);
  });

  it("formats sizes like the file header", () => {
    expect(formatSize(812)).toBe("812 Bytes");
    expect(formatSize(4424)).toBe("4.32 KB");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3 MB");
  });
});

describe("firstVisible", () => {
  // Lines 40px tall from y=100: bottoms at 140, 180, 220, …
  const bottom = (index: number) => 140 + index * 40;

  it("finds the first line not yet scrolled past", () => {
    expect(firstVisible(50, bottom, 0)).toBe(0);
    expect(firstVisible(50, bottom, 140)).toBe(1);
    expect(firstVisible(50, bottom, 141)).toBe(1);
    expect(firstVisible(50, bottom, 500)).toBe(10);
  });

  it("stays on the last line past the end, and on 0 when empty", () => {
    expect(firstVisible(5, bottom, 10_000)).toBe(4);
    expect(firstVisible(0, bottom, 0)).toBe(0);
  });
});
