// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFS,
  readPosition,
  readPrefs,
  readerDocument,
  savePosition,
  savePrefs,
} from "./readerPreview";
import { CONTENT_ID } from "./highlightDom";

beforeEach(() => localStorage.clear());

describe("readerDocument", () => {
  it("prepends an escaped title and wraps content in the reader wrapper", () => {
    const html = readerDocument(`A & <B> "c"`, "<p>x</p>", "vi", DEFAULT_PREFS);
    expect(html).toContain("<h1>A &amp; &lt;B&gt; &quot;c&quot;</h1>");
    expect(html).toContain(`<div id="${CONTENT_ID}">\n<p>x</p>\n</div>`);
    expect(html).toContain('<html lang="vi">');
  });

  it("falls back to en and escapes the language", () => {
    expect(readerDocument("t", "", "", DEFAULT_PREFS)).toContain('<html lang="en">');
    expect(readerDocument("t", "", 'x"y', DEFAULT_PREFS)).toContain('lang="x&quot;y"');
  });

  it("applies theme, font and sizes", () => {
    const html = readerDocument("t", "", "en", {
      ...DEFAULT_PREFS,
      theme: "sepia",
      font: "georgia",
      fontSize: 22,
      lineHeight: 1.8,
    });
    expect(html).toContain("#f4ecd8");
    expect(html).toContain("font-family: Georgia, serif;");
    expect(html).toContain("font-size: 22px;");
    expect(html).toContain("line-height: 1.8;");
  });

  it("falls back to the book font for an unknown font", () => {
    const html = readerDocument("t", "", "en", { ...DEFAULT_PREFS, font: "nope" as never });
    expect(html).toContain("font-family: serif;");
  });
});

describe("prefs storage", () => {
  it("returns defaults when empty or corrupt", () => {
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem("reader-prefs", "{bad");
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("round-trips", () => {
    const prefs = { fontSize: 24, lineHeight: 1.8, theme: "dark", font: "verdana", toc: false } as const;
    savePrefs(prefs);
    expect(readPrefs()).toEqual(prefs);
  });

  it("sanitises invalid fields individually", () => {
    localStorage.setItem(
      "reader-prefs",
      JSON.stringify({ fontSize: "big", lineHeight: 2, theme: "neon", font: "comic", toc: "yes" })
    );
    expect(readPrefs()).toEqual({ ...DEFAULT_PREFS, lineHeight: 2 });
  });

  it("does not throw when storage fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => savePrefs(DEFAULT_PREFS)).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe("reading position", () => {
  it("is null when missing or malformed", () => {
    expect(readPosition("s", false)).toBeNull();
    localStorage.setItem("reader-position:s", JSON.stringify({ scroll: 3 }));
    expect(readPosition("s", false)).toBeNull();
  });

  it("defaults scroll to 0", () => {
    localStorage.setItem("reader-position:s", JSON.stringify({ order: 4 }));
    expect(readPosition("s", false)).toEqual({ order: 4, scroll: 0 });
  });

  it("keeps public and private positions apart", () => {
    savePosition("s", false, { order: 1, scroll: 10 });
    savePosition("s", true, { order: 2, scroll: 20 });
    expect(readPosition("s", false)).toEqual({ order: 1, scroll: 10 });
    expect(readPosition("s", true)).toEqual({ order: 2, scroll: 20 });
    expect(localStorage.getItem("reader-position:private:s")).not.toBeNull();
  });
});
