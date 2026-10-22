import { describe, expect, it } from "vitest";
import { chapterFileName, sheetName, slugify, storyFolderName } from "./slug";

describe("slugify", () => {
  const cases: [string, string][] = [
    ["Trở Về Thời Niên Thiếu", "tro-ve-thoi-nien-thieu"],
    ["Đấu Phá Thương Khung", "dau-pha-thuong-khung"],
    ["  Chương 12: Gặp lại!  ", "chuong-12-gap-lai"],
    ["The King's Avatar", "the-king-s-avatar"],
    ["!!!", ""],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => expect(slugify(input)).toBe(expected));
  }

  it("cuts long titles on a word boundary within the limit", () => {
    const slug = slugify("Một câu chuyện rất dài về những người bạn cùng lớp năm ấy", 30);
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug.endsWith("-")).toBe(false);
    expect("mot-cau-chuyen-rat-dai-ve-nhung-nguoi".startsWith(slug)).toBe(true);
  });
});

describe("names", () => {
  it("names a story folder by its slug, or a numbered module when neutral or empty", () => {
    expect(storyFolderName("Đấu Phá", 0, false)).toBe("dau-pha");
    expect(storyFolderName("Đấu Phá", 0, true)).toBe("module-01");
    expect(storyFolderName("???", 11, false)).toBe("module-12");
  });

  it("names chapter files by zero-padded order", () => {
    expect(chapterFileName(12, "Chương 12: Gặp lại", false)).toBe("ch-0012-chuong-12-gap-lai.md");
    expect(chapterFileName(12, "Chương 12", true)).toBe("part-0012.md");
    expect(chapterFileName(3, "", false)).toBe("ch-0003.md");
  });

  it("keeps sheet names within the spreadsheet limit of 31 characters", () => {
    const name = sheetName("Một câu chuyện rất dài về những người bạn cùng lớp năm ấy", 0, false);
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[[\]:*?/\\-]/);
    expect(sheetName("Truyện", 2, true)).toBe("Sheet3");
  });
});
