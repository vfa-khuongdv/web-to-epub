import { describe, expect, it } from "vitest";
import { applySymbolLetters, looksBroken, symbolLetters } from "./pdfTextRepair";

const clean = ["đàn ông làm việc", "cách nhân hậu", "đàn bà", "làm đàn", "nhân cách", "cách làm"];
const broken = Array.from({ length: 30 }, () => ["đ|n ông l|m", "c{ch nh}n", "b|"]).flat();
const texts = [...clean, ...clean, ...broken];

describe("symbolLetters", () => {
  it("votes each symbol's letter from the document's clean words", () => {
    const letters = symbolLetters(texts);
    expect(letters.get("|")).toBe("à");
    expect(letters.get("{")).toBe("á");
    expect(letters.get("}")).toBe("â");
  });

  it("leaves a symbol alone when it is rare", () => {
    expect(symbolLetters([...clean, "đ|n", "a | b"]).size).toBe(0);
  });
});

describe("applySymbolLetters", () => {
  const letters = new Map([["|", "à"], ["{", "á"]]);

  it("replaces symbols that sit against a letter", () => {
    expect(applySymbolLetters("đ|n b|, c{ch", letters)).toBe("đàn bà, cách");
  });

  it("keeps a symbol standing alone", () => {
    expect(applySymbolLetters("a | b { c", letters)).toBe("a | b { c");
  });

  it("uses a capital between capitals", () => {
    expect(applySymbolLetters("N|Y", letters)).toBe("NÀY");
  });
});

describe("looksBroken", () => {
  it("flags symbols inside words in volume", () => {
    expect(looksBroken(Array.from({ length: 30 }, () => "đ|n ông"))).toBe(true);
  });

  it("flags the fragments a dropped vowel leaves", () => {
    expect(looksBroken(Array.from({ length: 40 }, () => "người ta c ng vậy"))).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(looksBroken(Array.from({ length: 100 }, () => "đàn ông cũng làm việc | a { b"))).toBe(false);
    expect(looksBroken(["The quick brown fox jumps over the lazy dog."])).toBe(false);
  });
});
