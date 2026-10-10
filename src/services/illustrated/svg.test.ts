import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./svg";

describe("sanitizeSvg", () => {
  it("keeps allowed shapes and attributes", () => {
    const svg = '<g><circle cx="0" cy="-20" r="10" fill="#f7c9a4"/><path d="M0 0 L10 10" stroke="#000" stroke-width="3"/></g>';
    expect(sanitizeSvg(svg)).toBe(svg);
  });

  it.each([
    ["a script element", "<g><script>alert(1)</script></g>"],
    ["an event handler", '<g><circle r="3" onclick="x()"/></g>'],
    ["a url() reference", '<g><rect width="3" height="3" fill="url(#a)"/></g>'],
    ["text content", "<g>hello</g>"],
    ["an image", '<g><image href="x.png"/></g>'],
    ["a comment", "<g><!-- x --></g>"],
    ["unbalanced tags", "<g><g></g>"],
    ["no element at all", "just text"],
    ["a non-string", 42],
  ])("refuses %s", (_name, input) => {
    expect(sanitizeSvg(input)).toBeUndefined();
  });

  it("refuses a drawing with too many elements", () => {
    expect(sanitizeSvg(`<g>${'<circle r="1"/>'.repeat(400)}</g>`)).toBeUndefined();
  });
});
