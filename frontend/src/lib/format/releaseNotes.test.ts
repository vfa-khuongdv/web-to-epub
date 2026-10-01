import { describe, expect, it } from "vitest";
import { parseInline, parseReleaseNotes } from "./releaseNotes";

describe("parseInline", () => {
  it("reads bold, code and links, keeping the text between them", () => {
    expect(parseInline("Adds **AI crawler** for `any` site, see [docs](https://x.test/a).")).toEqual([
      { kind: "text", text: "Adds " },
      { kind: "bold", text: "AI crawler" },
      { kind: "text", text: " for " },
      { kind: "code", text: "any" },
      { kind: "text", text: " site, see " },
      { kind: "link", text: "docs", href: "https://x.test/a" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves a link that is not http(s) as plain text", () => {
    expect(parseInline("[click](javascript:alert(1))")).toEqual([{ kind: "text", text: "[click](javascript:alert(1))" }]);
  });

  it("never produces markup from raw HTML: it stays text", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("parseReleaseNotes", () => {
  const notes = [
    "Adds an AI crawler and two book sources.",
    "",
    "## AI crawler",
    "",
    "- **Read any site** with AI.",
    "- The AI only chooses;",
    "  it never writes the story.",
    "",
    "## Fixes",
    "- Deleting several stories at once keeps going.",
  ].join("\n");

  it("splits a release body into paragraphs, headings and bullet lists", () => {
    const blocks = parseReleaseNotes(notes);
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "heading", "list", "heading", "list"]);
    expect(blocks[1]).toMatchObject({ kind: "heading", level: 2 });
  });

  it("keeps a wrapped bullet in one item", () => {
    const list = parseReleaseNotes(notes)[2];
    expect(list.kind).toBe("list");
    if (list.kind !== "list") return;
    expect(list.items).toHaveLength(2);
    expect(list.items[1].map((i) => i.text).join("")).toBe("The AI only chooses; it never writes the story.");
  });

  it("joins the lines of a paragraph", () => {
    const [paragraph] = parseReleaseNotes("one\ntwo\n\nthree");
    expect(paragraph).toEqual({ kind: "paragraph", inline: [{ kind: "text", text: "one two" }] });
  });

  it("gives the deepest headings the smallest size", () => {
    expect(parseReleaseNotes("###### deep")[0]).toMatchObject({ kind: "heading", level: 3 });
  });

  it("is empty for empty notes", () => {
    expect(parseReleaseNotes("")).toEqual([]);
  });
});
