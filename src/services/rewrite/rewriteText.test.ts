import { describe, expect, it } from "vitest";
import { chunkParagraphs, missingNames, parseRewriteReply, validateRewrite } from "./rewriteText";

describe("chunkParagraphs", () => {
  it("groups paragraphs up to the word budget", () => {
    const paragraphs = Array.from({ length: 4 }, () => Array.from({ length: 200 }, (_, i) => `w${i}`).join(" "));
    const chunks = chunkParagraphs(paragraphs, 300);
    expect(chunks.map((chunk) => chunk.length)).toEqual([1, 1, 1, 1]);
    expect(chunkParagraphs(["a b c", "d e f"], 100)).toEqual([["a b c", "d e f"]]);
  });

  it("splits one paragraph longer than the whole budget", () => {
    const long = "một câu ngắn. ".repeat(400);
    const chunks = chunkParagraphs([long], 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk).toHaveLength(1);
  });
});

describe("parseRewriteReply", () => {
  it("reads paragraphs from JSON even inside prose or a fence", () => {
    expect(parseRewriteReply('Here you go:\n```json\n{"paragraphs":["Một.","Hai."]}\n```')).toEqual(["Một.", "Hai."]);
    expect(parseRewriteReply('{"paragraphs":["  Một   câu.  "]}')).toEqual(["Một câu."]);
  });

  it("rejects a reply without JSON or without the array", () => {
    expect(() => parseRewriteReply("Một. Hai.")).toThrow(/JSON/);
    expect(() => parseRewriteReply('{"text": "Một."}')).toThrow(/paragraphs/);
  });
});

describe("validateRewrite", () => {
  const source = ["Anh đi đâu về muộn thế?", "Hắn cười nhạt."];

  it("accepts a rewrite that keeps the paragraphs and the content", () => {
    expect(validateRewrite(source, ['"Anh đi đâu về muộn thế?" cô hỏi.', "Hắn cười nhạt."])).toBeNull();
  });

  it("rejects merged paragraphs, digits and symbols", () => {
    expect(validateRewrite(source, ["gộp lại"])).toMatch(/merged/);
    expect(validateRewrite(source, ["anh đi đâu ba giờ", "x"])).toBeNull();
    expect(validateRewrite(source, ["anh đi đâu 3 giờ", "x"])).toMatch(/digits/);
    expect(validateRewrite(source, ["anh đi **đâu**", "x"])).toMatch(/symbol/);
  });

  it("rejects a rewrite that drops most words or names", () => {
    const long = [
      "Nguyễn Văn A đi đến nhà Trần Thị B ở Hà Nội cùng Châu Toàn vào một buổi sáng rất đẹp trời và ấm áp.".repeat(3),
    ];
    expect(validateRewrite(long, ["A đến nhà B."])).toMatch(/short/);
  });
});

describe("missingNames", () => {
  it("lists capitalized names that disappeared once there are enough of them", () => {
    const source = "Châu Mạt gặp Tạ Xiễn ở Hà Nội cùng Trần Tố Duyên và Châu Toàn.";
    expect(missingNames(source, "Châu Mạt gặp Tạ Xiễn ở Hà Nội cùng Trần Tố Duyên.")).toEqual(["Châu Toàn"]);
    expect(missingNames("Hai tên.", "Hai.")).toEqual([]);
  });
});
