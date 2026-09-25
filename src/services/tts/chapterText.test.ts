import { describe, expect, it } from "vitest";
import { chapterParts, chapterPartsWithBlocks, splitLongText } from "./chapterText";

describe("splitLongText", () => {
  it("keeps short text as one part", () => {
    expect(splitLongText("Xin chào.", 50)).toEqual(["Xin chào."]);
  });

  it("groups whole sentences up to the limit", () => {
    const text = "Câu một ngắn. Câu hai cũng ngắn! Câu ba thì sao? Câu bốn.";
    const parts = splitLongText(text, 32);
    expect(parts).toEqual(["Câu một ngắn. Câu hai cũng ngắn!", "Câu ba thì sao? Câu bốn."]);
    expect(parts.every((p) => p.length <= 32)).toBe(true);
  });

  it("keeps a closing quote with its sentence", () => {
    const parts = splitLongText('Bà gọi: "Con ơi, về thôi!" Minh quay lại nhìn.', 30);
    expect(parts[0]).toBe('Bà gọi: "Con ơi, về thôi!"');
  });

  it("splits an overlong sentence at a comma or space, never mid-word", () => {
    const sentence = Array.from({ length: 40 }, (_, i) => `từ${i}`).join(" ") + ".";
    const parts = splitLongText(sentence, 50);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 50 && p.length > 0)).toBe(true);
    expect(parts.join(" ")).toBe(sentence);
  });

  it("hard-cuts a single token longer than the limit", () => {
    const parts = splitLongText("a".repeat(120), 50);
    expect(parts.map((p) => p.length)).toEqual([50, 50, 20]);
  });
});

describe("chapterParts", () => {
  it("reads the title, headings and paragraphs as plain text; skips media", () => {
    const parts = chapterParts("Chương 1: Khởi đầu", [
      { type: "heading", level: 2, text: "Phần một" },
      { type: "paragraph", text: "Anh <b>bước</b> vào &amp; ngồi xuống." },
      { type: "image", src: "https://x/y.png", alt: "" },
      { type: "audio", src: "https://x/a.mp3" },
      { type: "paragraph", text: "   " },
    ]);
    expect(parts).toEqual(["Chương 1: Khởi đầu", "Phần một", "Anh bước vào & ngồi xuống."]);
  });

  it("does not read a heading that repeats the title", () => {
    const parts = chapterParts("Chương 2", [
      { type: "heading", level: 1, text: "Chương 2" },
      { type: "paragraph", text: "Nội dung." },
    ]);
    expect(parts).toEqual(["Chương 2", "Nội dung."]);
  });

  it("splits long paragraphs", () => {
    const long = "Đây là một câu khá dài để kiểm tra. ".repeat(20);
    const parts = chapterParts("", [{ type: "paragraph", text: long }]);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 250)).toBe(true);
  });

  it("says which block each part reads: -1 for the title, the block index otherwise", () => {
    const long = "Một câu dài vừa phải để tách. ".repeat(12);
    const parts = chapterPartsWithBlocks("Chương 3", [
      { type: "heading", level: 1, text: "Chương 3" },
      { type: "image", src: "x.png" },
      { type: "paragraph", text: long },
      { type: "paragraph", text: "Cuối." },
    ]);
    expect(parts[0]).toEqual({ text: "Chương 3", block: -1 });
    const blocks = parts.slice(1).map((p) => p.block);
    expect(new Set(blocks.slice(0, -1))).toEqual(new Set([2]));
    expect(blocks.length).toBeGreaterThan(2);
    expect(parts.at(-1)).toEqual({ text: "Cuối.", block: 3 });
  });
});

