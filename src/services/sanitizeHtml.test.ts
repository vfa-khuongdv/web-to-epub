import { describe, expect, it } from "vitest";
import { sanitizeBlocks, sanitizeInlineHtml } from "./sanitizeHtml";

describe("sanitizeInlineHtml", () => {
  it("keeps plain text and inline formatting", () => {
    expect(sanitizeInlineHtml("hello")).toBe("hello");
    expect(sanitizeInlineHtml("a <em>b</em> <a href=\"https://x.test/\">c</a>")).toBe(
      "a <em>b</em> <a href=\"https://x.test/\">c</a>"
    );
  });

  it("removes event handlers, javascript: links and script-capable tags", () => {
    const out = sanitizeInlineHtml(
      '<img src=x onerror="alert(1)"><a href="java\tscript:alert(1)">x</a><script>1</script><svg onload=1></svg><b style="x:y">b</b>'
    );
    expect(out).not.toMatch(/onerror|onload|javascript|script|svg|style/i);
    expect(out).toContain("<b>b</b>");
  });
});

describe("sanitizeBlocks", () => {
  it("cleans paragraph/heading text and attribute-breaking alt/src", () => {
    const [p, h, img, bad] = sanitizeBlocks([
      { type: "paragraph", text: "<img src=x onerror=alert(1)>" },
      { type: "heading", level: 2, text: "<b onclick=1>t</b>" },
      { type: "image", src: 'https://x.test/a.jpg"onerror="1', alt: '" onerror="1' },
      { type: "image", src: "javascript:alert(1)" },
    ]);
    expect(p.text).not.toContain("onerror");
    expect(h.text).toBe("<b>t</b>");
    expect(img.src).not.toContain('"');
    expect(img.alt).not.toContain('"');
    expect(bad.src).toBe("");
  });
});
