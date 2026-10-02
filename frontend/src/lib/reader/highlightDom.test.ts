// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { Highlight } from "../api";

import { CONTENT_ID, markAt, paint, paintAll, recolor, unpaint } from "./highlightDom";

// jsdom has no CSS.escape.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (value: string) => value };

const highlight = (id: string, start: number, end: number, color: Highlight["color"] = "yellow"): Highlight => ({
  id,
  chapterOrder: 1,
  start,
  end,
  color,
  text: "",
  createdAt: "",
});

const marks = (id: string) => Array.from(document.querySelectorAll(`mark[data-highlight="${id}"]`));

describe("highlightDom", () => {
  beforeEach(() => {
    document.body.innerHTML = `<h1>Title</h1><div id="${CONTENT_ID}"><p>Hello <b>big</b> world</p><p>Second</p></div>`;
  });

  it("wraps the stored range, measured over the chapter text only (not the title)", () => {
    paint(document, highlight("a", 0, 5));
    expect(marks("a").map((m) => m.textContent).join("")).toBe("Hello");
    expect(marks("a")[0].className).toBe("hl hl-yellow");
  });

  it("splits a range across element boundaries into one mark per text node", () => {
    paint(document, highlight("a", 3, 13)); // "lo big wor"
    expect(marks("a").map((m) => m.textContent)).toEqual(["lo ", "big", " wor"]);
  });

  it("leaves the text itself unchanged, so later highlights keep their offsets", () => {
    paintAll(document, [highlight("a", 0, 5), highlight("b", 6, 9)]);
    expect(document.getElementById(CONTENT_ID)!.textContent).toBe("Hello big worldSecond");
    expect(marks("b")[0].textContent).toBe("big");
  });

  it("does nothing when the content root is missing", () => {
    document.body.innerHTML = "<p>no root</p>";
    paint(document, highlight("a", 0, 2));
    expect(marks("a")).toHaveLength(0);
  });

  it("recolors in place", () => {
    paint(document, highlight("a", 0, 5));
    recolor(document, "a", "pink");
    expect(marks("a")[0].className).toBe("hl hl-pink");
  });

  it("unpaints back to the original text and merges the split text nodes", () => {
    paint(document, highlight("a", 3, 13));
    unpaint(document, "a");
    expect(marks("a")).toHaveLength(0);
    expect(document.querySelector("p")!.childNodes).toHaveLength(3); // "Hello ", <b>, " world"
    expect(document.getElementById(CONTENT_ID)!.textContent).toBe("Hello big worldSecond");
  });

  it("finds the highlight under an event target, or null outside a mark", () => {
    paint(document, highlight("a", 0, 5));
    const inside = marks("a")[0];
    expect(markAt(inside)?.id).toBe("a");
    expect(markAt(document.querySelector("h1"))).toBeNull();
    expect(markAt(null)).toBeNull();
  });
});
