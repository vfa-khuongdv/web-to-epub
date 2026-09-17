import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeStoryUrl } from "./normalizeUrl";
import { parseChapterLinks, parseStoryMeta, parseTotalPages } from "./truyenfullTemplate";

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");
const nfc = (s: string) => s.normalize("NFC");

describe("parseStoryMeta (template truyenfull)", () => {
  it("truyenfull.live: title/author/cover", () => {
    const meta = parseStoryMeta(readFixture("truyenfull-story.html"), "https://truyenfull.live/dau-xuan-tuoi-sang/");
    expect(nfc(meta.title)).toBe(nfc("Đầu Xuân Tươi Sáng"));
    expect(meta.author).toBeTruthy();
    expect(meta.coverUrl?.startsWith("https://lh3.googleusercontent.com")).toBe(true);
  });

  it("truyencom.com: title lấy từ h1", () => {
    const meta = parseStoryMeta(readFixture("truyencom-story.html"), "https://truyencom.com/de-ba.27/");
    expect(nfc(meta.title)).toBe(nfc("Đế Bá"));
    expect(meta.author).toBeTruthy();
  });
});

describe("parseChapterLinks", () => {
  it("truyenfull.live: 50 chương trang 1, giữ đúng thứ tự", () => {
    const chapters = parseChapterLinks(readFixture("truyenfull-story.html"), "https://truyenfull.live/dau-xuan-tuoi-sang/");
    expect(chapters).toHaveLength(50);
    expect(chapters[0].url).toBe("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-1/");
    expect(chapters[49].url).toBe("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-50/");
    expect(nfc(chapters[0].title)).toContain(nfc("Chương 1"));
  });

  it("truyencom.com: 50 chương, href .html", () => {
    const chapters = parseChapterLinks(readFixture("truyencom-story.html"), "https://truyencom.com/de-ba.27/");
    expect(chapters).toHaveLength(50);
    expect(chapters[0].url).toBe("https://truyencom.com/de-ba/chuong-1.html");
  });
});

describe("parseTotalPages", () => {
  it("truyenfull.live: đọc từ #total-page", () => {
    expect(parseTotalPages(readFixture("truyenfull-story.html"))).toBe(3);
  });

  it("truyencom.com: suy ra từ pagination links", () => {
    expect(parseTotalPages(readFixture("truyencom-story.html"))).toBe(140);
  });
});

describe("normalizeStoryUrl", () => {
  it("cắt URL chương truyenfull về URL truyện", () => {
    expect(normalizeStoryUrl("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-12/")).toBe(
      "https://truyenfull.live/dau-xuan-tuoi-sang/"
    );
  });

  it("cắt URL chương .html của truyencom về URL truyện", () => {
    expect(normalizeStoryUrl("https://truyencom.com/de-ba/chuong-118.html")).toBe("https://truyencom.com/de-ba/");
  });

  it("giữ nguyên URL truyện, bỏ query/hash", () => {
    expect(normalizeStoryUrl("https://truyenfull.live/dau-xuan-tuoi-sang/?abc=1#x")).toBe(
      "https://truyenfull.live/dau-xuan-tuoi-sang/"
    );
  });
});
