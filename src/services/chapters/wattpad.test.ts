import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LockedContentError } from "../extractor";
import { parseWattpadChapter } from "./wattpad";

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

const CHAPTER_URL = "https://www.wattpad.com/148415654-pumpkin-patch-princess-chapter-two-visiting";

describe("parseWattpadChapter", () => {
  it("lấy tiêu đề từ h1 và map các đoạn văn trong <pre>, bỏ qua div quảng cáo/audio", () => {
    const chapter = parseWattpadChapter(readFixture("wattpad-chapter.html"), CHAPTER_URL);

    expect(chapter.sourceUrl).toBe(CHAPTER_URL);
    expect(chapter.title).toBe("CHAPTER TWO: Visiting Valentine");
    expect(chapter.blocks).toHaveLength(12);
    expect(chapter.blocks.every((b) => b.type === "paragraph")).toBe(true);
    expect(chapter.blocks[0].text).toBe(
      "I stopped to say hello to Miss Jenkins, who had worked at the library for as long as I could remember."
    );
    expect(chapter.blocks.some((b) => (b.text || "").includes("Advertisement"))).toBe(false);
  });

  it("báo LockedContentError khi chương nằm sau paywall (Paid Stories)", () => {
    const url = "https://www.wattpad.com/643127331-of-cages-and-crowns-previously-the-culled-crown";
    expect(() => parseWattpadChapter(readFixture("wattpad-paid-chapter.html"), url)).toThrow(LockedContentError);
    expect(() => parseWattpadChapter(readFixture("wattpad-paid-chapter.html"), url)).toThrow(/trả phí/);
  });

  it("báo lỗi thường khi trang không có nội dung chương", () => {
    expect(() => parseWattpadChapter("<html><head><title>X</title></head><body>loading</body></html>", CHAPTER_URL)).toThrow(
      /Không tìm thấy nội dung chương/
    );
  });

  it("dùng <title> (bỏ hậu tố Wattpad) khi trang thiếu h1", () => {
    const html =
      '<html><head><title>Truyện A - Chương 5 - Wattpad</title></head><body><pre><p data-p-id="x">Nội dung</p></pre></body></html>';
    const chapter = parseWattpadChapter(html, CHAPTER_URL);
    expect(chapter.title).toBe("Truyện A - Chương 5");
    expect(chapter.blocks).toHaveLength(1);
  });
});
