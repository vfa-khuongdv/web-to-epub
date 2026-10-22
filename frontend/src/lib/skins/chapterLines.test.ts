// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { chapterLines, plainText, withoutTitleHeading, wordCount } from "./chapterLines";

describe("plainText", () => {
  it("keeps only the text of inline HTML", () => {
    expect(plainText("Anh <em>nói</em> &amp; cười")).toBe("Anh nói & cười");
    expect(plainText("dòng một<br>dòng hai")).toBe("dòng một dòng hai");
  });

  it("never runs or keeps markup", () => {
    expect(plainText('<img src=x onerror="alert(1)">chữ<script>alert(2)</script>')).toBe("chữalert(2)");
  });

  it("collapses whitespace", () => {
    expect(plainText("  a \n\n b\t c ")).toBe("a b c");
  });
});

describe("chapterLines", () => {
  it("turns each block into one line, by kind", () => {
    const lines = chapterLines([
      { type: "heading", level: 2, text: "Chương 1" },
      { type: "paragraph", text: "Đoạn <b>một</b>." },
      { type: "paragraph", text: "   " },
      { type: "image", src: "https://cdn.example/p1.jpg", alt: "Trang 1" },
      { type: "audio", src: "https://cdn.example/a.mp3" },
      { type: "video" },
    ]);
    expect(lines).toEqual([
      { kind: "heading", text: "Chương 1" },
      { kind: "text", text: "Đoạn một." },
      { kind: "media", text: "[image: Trang 1]" },
      { kind: "media", text: "[audio]" },
      { kind: "media", text: "[video]" },
    ]);
  });

  // Some sites send a whole chapter as one block whose paragraphs are <br><br> runs; the
  // reader shows those as breaks, so a skin must too — not one 7000-character line.
  it("splits a block at its line breaks", () => {
    const lines = chapterLines([
      { type: "paragraph", text: "Đoạn một.<br><br>\nĐoạn <i>hai</i>.<br/>Dòng ba.<br><br>" },
      { type: "heading", text: "Phần<br>hai" },
    ]);
    expect(lines).toEqual([
      { kind: "text", text: "Đoạn một." },
      { kind: "text", text: "Đoạn hai." },
      { kind: "text", text: "Dòng ba." },
      { kind: "heading", text: "Phần hai" },
    ]);
  });

  it("never carries a media address", () => {
    const lines = chapterLines([{ type: "image", src: "https://cdn.example/secret.jpg" }]);
    expect(JSON.stringify(lines)).not.toContain("cdn.example");
  });

  it("counts words, not placeholders", () => {
    expect(wordCount(chapterLines([{ type: "paragraph", text: "một hai ba" }, { type: "image", alt: "x y" }]))).toBe(3);
  });
});

describe("withoutTitleHeading", () => {
  it("leaves out a leading heading, and nothing else", () => {
    const lines = chapterLines([
      { type: "heading", text: "Chương 1: Trở về" },
      { type: "paragraph", text: "Đoạn một." },
      { type: "heading", text: "Phần hai" },
    ]);
    expect(withoutTitleHeading(lines).map((line) => line.text)).toEqual(["Đoạn một.", "Phần hai"]);
    expect(withoutTitleHeading(lines.slice(1))).toEqual(lines.slice(1));
    expect(withoutTitleHeading([])).toEqual([]);
  });
});
