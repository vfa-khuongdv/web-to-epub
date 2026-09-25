import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { activePart, markNarrating, NARRATING_CLASS } from "./narrationHighlight";

describe("activePart", () => {
  const parts = [
    { block: -1, start: 0, end: 1 },
    { block: 0, start: 1.35, end: 4 },
    { block: 2, start: 4.35, end: 6 },
  ];
  it("finds the part being read, and holds it through the pause after it", () => {
    expect(activePart(parts, 0)).toBe(0);
    expect(activePart(parts, 1.2)).toBe(0); // pause after the title
    expect(activePart(parts, 2)).toBe(1);
    expect(activePart(parts, 5)).toBe(2);
    expect(activePart(parts, 99)).toBe(2);
    expect(activePart([{ block: 0, start: 0.5, end: 1 }], 0.1)).toBe(-1);
    expect(activePart([], 3)).toBe(-1);
  });
});

describe("markNarrating", () => {
  const doc = new JSDOM(
    `<body><h1>Title</h1><div id="reader-content"><p>one</p>\n<img src="x" />\n<p>three</p></div></body>`
  ).window.document;

  it("marks the title for -1 and the block's element otherwise, one at a time", () => {
    expect(markNarrating(doc, -1, false)?.tagName).toBe("H1");
    expect(markNarrating(doc, 2, false)?.textContent).toBe("three");
    expect(doc.getElementsByClassName(NARRATING_CLASS)).toHaveLength(1);
    expect(markNarrating(doc, 9, false)).toBeNull();
    expect(doc.getElementsByClassName(NARRATING_CLASS)).toHaveLength(0);
    markNarrating(doc, 0, false);
    markNarrating(doc, null);
    expect(doc.getElementsByClassName(NARRATING_CLASS)).toHaveLength(0);
  });

  it("does nothing on a frame's blank document, which has no body yet", () => {
    const blank = new JSDOM("").window.document.implementation.createDocument(null, "html");
    expect(blank.body).toBeNull();
    expect(() => markNarrating(blank, -1)).not.toThrow();
    expect(markNarrating(blank, 0)).toBeNull();
  });
});

