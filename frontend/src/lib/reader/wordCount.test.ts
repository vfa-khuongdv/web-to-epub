// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { countWords } from "./wordCount";

describe("countWords", () => {
  it("counts whitespace-separated runs across paragraphs", () => {
    expect(countWords("<p>one two three</p>\n<p>four  five</p>")).toBe(5);
  });

  it("does not count markup", () => {
    expect(countWords('<p class="x"><b>bold</b> <a href="#">link</a></p><img src="a.png">')).toBe(2);
  });

  it("counts Vietnamese syllables separated by spaces", () => {
    expect(countWords("<p>Hôm nay trời đẹp quá</p>")).toBe(5);
  });

  it("is zero for an empty chapter", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("<p>   </p>")).toBe(0);
  });
});
