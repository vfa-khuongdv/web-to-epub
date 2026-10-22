import { describe, expect, it } from "vitest";
import {
  dateLine,
  estimatedSize,
  etaText,
  humanSize,
  lastLogin,
  lsDate,
  lsGrid,
  lsLong,
  morningLogin,
  progressBar,
  wcLine,
} from "./format";

const NOW = new Date(2026, 9, 6, 14, 2, 9);

describe("dates", () => {
  it("prints recent dates with the time and old ones with the year, as ls does", () => {
    expect(lsDate(new Date(2026, 9, 6, 9, 5).toISOString(), NOW)).toBe("Oct  6 09:05");
    expect(lsDate(new Date(2025, 0, 21, 9, 5).toISOString(), NOW)).toBe("Jan 21  2025");
    expect(lsDate(undefined, NOW)).toBe("Oct  6 14:02");
  });

  it("prints the login banner and date in the C locale", () => {
    expect(lastLogin(NOW)).toBe("Last login: Tue Oct  6 14:02:09 on ttys001");
    expect(dateLine(NOW)).toMatch(/^Tue Oct {2}6 14:02:09 [+-]\d{4} 2026$/);
  });

  it("starts the decoy's session this morning, or an hour ago before then", () => {
    expect(lastLogin(morningLogin(NOW))).toBe("Last login: Tue Oct  6 08:47:12 on ttys001");
    const early = new Date(2026, 9, 6, 7, 30, 0);
    expect(morningLogin(early)).toEqual(new Date(2026, 9, 6, 6, 30, 0));
    const atMidnight = new Date(2026, 9, 6, 0, 20, 0);
    expect(morningLogin(atMidnight).getTime()).toBeLessThan(atMidnight.getTime());
  });
});

describe("sizes", () => {
  it("prints human sizes", () => {
    expect(humanSize(512)).toBe("512B");
    expect(humanSize(1229)).toBe("1.2K");
    expect(humanSize(18432)).toBe("18K");
    expect(humanSize(3.4 * 1024 * 1024)).toBe("3.4M");
  });

  it("keeps an unread file's size steady and plausible", () => {
    expect(estimatedSize("s", 3)).toBe(estimatedSize("s", 3));
    for (let order = 1; order < 50; order++) {
      const size = estimatedSize("story", order);
      expect(size).toBeGreaterThanOrEqual(9000);
      expect(size).toBeLessThan(26000);
    }
  });
});

describe("progressBar", () => {
  it("fills the bar in proportion and prints the count", () => {
    expect(progressBar(12, 150, 10)).toBe("[#---------] 12/150   8%");
    expect(progressBar(150, 150, 10)).toBe("[##########] 150/150 100%");
    expect(progressBar(0, 0, 4)).toBe("[----] 0/0   0%");
  });

  it("prints the time left", () => {
    expect(etaText(45_000)).toBe("45s");
    expect(etaText(192_000)).toBe("3m12s");
    expect(etaText(3_900_000)).toBe("1h05m");
    expect(etaText(undefined)).toBe("");
  });
});

describe("ls", () => {
  it("aligns the long listing and counts blocks", () => {
    const { total, rows } = lsLong(
      [
        { name: "tro-ve", tone: "dir", size: 160, links: 5, date: NOW.toISOString() },
        { name: "ch-0001.md", tone: "file", size: 18234, links: 1, date: NOW.toISOString() },
      ],
      NOW,
      false
    );
    expect(total).toBe("total 48");
    expect(rows[0].meta).toBe("drwxr-xr-x  5 dev  staff    160 Oct  6 14:02");
    expect(rows[1].meta).toBe("-rw-r--r--  1 dev  staff  18234 Oct  6 14:02");
    expect(rows[1].name).toBe("ch-0001.md");
  });

  it("lays names out down then across, as many columns as fit", () => {
    const names = ["a", "bb", "ccc", "dddd", "e"].map((name) => ({ name, tone: "file" as const }));
    const grid = lsGrid(names, 14);
    expect(grid.map((row) => row.map((cell) => cell.name + " ".repeat(cell.pad)).join(""))).toEqual(["a   ccc   e", "bb  dddd"]);
    expect(lsGrid(names, 3).length).toBe(5);
    expect(lsGrid([], 80)).toEqual([]);
  });

  it("prints wc's columns", () => {
    expect(wcLine({ lines: 220, words: 3412, bytes: 18234 }, "ch-0001.md")).toBe("     220    3412   18234 ch-0001.md");
  });
});
