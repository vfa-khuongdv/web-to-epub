import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildChapterUrl, parseChaptersResponse, parseMangaId, parseStoryMeta } from "./xtruyen";
import { normalizeStoryUrl } from "./normalizeUrl";

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

describe("parseMangaId", () => {
  it("đọc data-id từ #manga-chapters-holder", () => {
    expect(parseMangaId(readFixture("xtruyen-story.html"))).toBe("2892796");
  });
});

describe("parseStoryMeta", () => {
  it("title/author/cover best-effort", () => {
    const meta = parseStoryMeta(readFixture("xtruyen-story.html"), "https://xtruyen.vn/truyen/han-phu/");
    expect(meta.title.normalize("NFC")).toBe("HÃN PHU".normalize("NFC"));
    expect(meta.author).toBe("Neleta");
    expect(meta.coverUrl?.startsWith("https://img.xtruyen.vn")).toBe(true);
  });
});

describe("parseChaptersResponse", () => {
  it("parse 100 item từ JSON API", () => {
    const items = parseChaptersResponse(readFixture("xtruyen-chapters.json"));
    expect(items).toHaveLength(100);
    expect(items[0]).toEqual({ slug: "chuong-1", title: "Chương 1" });
    expect(items[99].slug).toBe("chuong-100");
  });

  it("ném lỗi khi JSON sai định dạng", () => {
    expect(() => parseChaptersResponse("<html>khong phai json</html>")).toThrow();
  });
});

describe("buildChapterUrl", () => {
  it("ghép URL chương từ slug", () => {
    expect(buildChapterUrl("https://xtruyen.vn/truyen/han-phu/", "chuong-12")).toBe(
      "https://xtruyen.vn/truyen/han-phu/chuong-12/"
    );
  });
});

describe("normalizeStoryUrl (xtruyen)", () => {
  it("cắt URL chương về URL truyện", () => {
    expect(normalizeStoryUrl("https://xtruyen.vn/truyen/han-phu/chuong-233/")).toBe("https://xtruyen.vn/truyen/han-phu/");
  });
});
