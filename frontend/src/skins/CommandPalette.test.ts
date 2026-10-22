import { describe, expect, it } from "vitest";
import { PaletteCommand, filterCommands } from "./CommandPalette";

const command = (label: string, hint?: string): PaletteCommand => ({ id: label, label, hint, run: () => {} });

describe("filterCommands", () => {
  const commands = [
    command("Mở truyện này ở giao diện thường", "Thêm truyện, xuất EPUB"),
    command("Crawl tiếp"),
    command("Cài đặt"),
  ];

  it("shows everything for an empty query", () => {
    expect(filterCommands(commands, "  ")).toHaveLength(3);
  });

  it("matches every word, ignoring case and Vietnamese diacritics", () => {
    expect(filterCommands(commands, "mo giao dien").map((c) => c.label)).toEqual(["Mở truyện này ở giao diện thường"]);
    expect(filterCommands(commands, "CÀI").map((c) => c.label)).toEqual(["Cài đặt"]);
  });

  it("searches the hint too", () => {
    expect(filterCommands(commands, "epub").map((c) => c.label)).toEqual(["Mở truyện này ở giao diện thường"]);
  });

  it("finds nothing when one word is missing", () => {
    expect(filterCommands(commands, "crawl xyz")).toEqual([]);
  });

  it("keeps search-only commands off the open list, and finds them once typed", () => {
    const withLooks = [...commands, { ...command("Switch look: Spreadsheet"), searchOnly: true }];
    expect(filterCommands(withLooks, "").map((c) => c.label)).not.toContain("Switch look: Spreadsheet");
    expect(filterCommands(withLooks, "")).toHaveLength(3);
    expect(filterCommands(withLooks, "look").map((c) => c.label)).toEqual(["Switch look: Spreadsheet"]);
    expect(filterCommands(withLooks, "spread").map((c) => c.label)).toEqual(["Switch look: Spreadsheet"]);
  });
});
