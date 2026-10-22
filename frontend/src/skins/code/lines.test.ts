import { describe, expect, it } from "vitest";
import { clampParagraph, editorLine, editorLineCount, firstVisible, paragraphOf } from "./lines";

describe("editor lines", () => {
  it("puts paragraphs on odd lines", () => {
    expect([0, 1, 2].map(editorLine)).toEqual([1, 3, 5]);
  });

  it("counts the empty lines between paragraphs, not after the last", () => {
    expect(editorLineCount(0)).toBe(1);
    expect(editorLineCount(1)).toBe(1);
    expect(editorLineCount(3)).toBe(5);
  });

  it("maps an editor line back to its paragraph", () => {
    expect([1, 2, 3, 4, 5].map(paragraphOf)).toEqual([0, 0, 1, 1, 2]);
    expect(paragraphOf(0)).toBe(0);
  });

  it("round-trips every paragraph", () => {
    for (let p = 0; p < 50; p++) expect(paragraphOf(editorLine(p))).toBe(p);
  });

  it("clamps a stored paragraph to the chapter", () => {
    expect(clampParagraph(12, 5)).toBe(4);
    expect(clampParagraph(-3, 5)).toBe(0);
    expect(clampParagraph(2, 0)).toBe(0);
  });
});

describe("firstVisible", () => {
  const tops = [0, 40, 100, 180, 260];
  const cases: [number, number][] = [
    [0, 0],
    [39, 0],
    [40, 1],
    [99, 1],
    [181, 3],
    [10_000, 4],
    [-5, 0],
  ];
  for (const [scrollTop, row] of cases) {
    it(`scrollTop ${scrollTop} → row ${row}`, () => expect(firstVisible(tops, scrollTop)).toBe(row));
  }
  it("is 0 for no rows", () => expect(firstVisible([], 50)).toBe(0));
});
