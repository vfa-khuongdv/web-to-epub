import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { ContentBlock } from "../types";
import {
  LockedContentError,
  MatureContentError,
  SubscribersOnlyError,
  extractChapter,
  walkToBlocks,
} from "./extractor";

const blocksOf = (html: string): ContentBlock[] => {
  const dom = new JSDOM(`<body>${html}</body>`, { url: "https://x.test/" });
  const out: ContentBlock[] = [];
  walkToBlocks(dom.window.document.body, out);
  return out;
};

const prose = (n: number) => "Nội dung truyện khá dài để Readability giữ lại. ".repeat(n);

describe("walkToBlocks", () => {
  it("maps headings with their level and skips empty ones", () => {
    expect(blocksOf("<h2> Tiêu đề </h2><h3></h3>")).toEqual([{ type: "heading", level: 2, text: "Tiêu đề" }]);
  });

  it("keeps paragraph inner HTML and drops empty paragraphs", () => {
    expect(blocksOf("<p>a <em>b</em></p><p>  </p><blockquote>q</blockquote>")).toEqual([
      { type: "paragraph", text: "a <em>b</em>" },
      { type: "paragraph", text: "q" },
    ]);
  });

  it("emits images with resolved src and alt, ignoring ones without src", () => {
    expect(blocksOf('<img src="/a.png" alt="A"><img alt="none">')).toEqual([
      { type: "image", src: "https://x.test/a.png", alt: "A" },
    ]);
  });

  it("reads audio/video src, including <source> children", () => {
    const out = blocksOf('<audio src="/a.mp3"></audio><video><source src="/v.mp4"></video>');
    expect(out.map((b) => b.type)).toEqual(["audio", "video"]);
    expect(out[0].src).toBe("/a.mp3");
    expect(out[1].src).toBe("/v.mp4");
  });

  it("splits a figure into image and caption", () => {
    const out = blocksOf('<figure><img src="/f.png" alt="F"><figcaption>Chú thích</figcaption></figure>');
    expect(out).toEqual([
      { type: "image", src: "https://x.test/f.png", alt: "F" },
      { type: "paragraph", text: "Chú thích" },
    ]);
  });

  it("recurses into containers and keeps order", () => {
    const out = blocksOf("<div><section><h1>T</h1><p>one</p></section><ul><li>item</li></ul></div>");
    expect(out.map((b) => b.type)).toEqual(["heading", "paragraph", "paragraph"]);
    expect(out[2].text).toBe("item");
  });

  it("turns a childless text element into a paragraph and ignores empty ones", () => {
    expect(blocksOf("<span>hi</span><span> </span>")).toEqual([{ type: "paragraph", text: "hi" }]);
  });
});

describe("extractChapter", () => {
  it("extracts paragraphs and drops chrome by class/id token", () => {
    const html = `<html><head><title>Story - Chương 1 - Site</title></head><body>
      <div class="sidebar"><p>SIDEBAR-TEXT</p></div>
      <article><p>${prose(10)}</p><p>${prose(10)}</p></article>
      <div id="comments"><p>COMMENT-TEXT</p></div></body></html>`;
    const ch = extractChapter("https://x.test/c/1", html);
    const text = ch.blocks.map((b) => b.text).join(" ");
    expect(ch.sourceUrl).toBe("https://x.test/c/1");
    expect(text).toContain("Nội dung truyện");
    expect(text).not.toContain("SIDEBAR-TEXT");
    expect(text).not.toContain("COMMENT-TEXT");
  });

  it("does not treat substring class names like 'gradient' as chrome", () => {
    const html = `<html><head><title>T</title></head><body><div class="gradient loading"><p>${prose(15)}</p></div></body></html>`;
    const ch = extractChapter("https://x.test/c/1", html);
    expect(ch.blocks.length).toBeGreaterThan(0);
  });

  it("prefers the site's chapter-title selector over <title>", () => {
    const html = `<html><head><title>Story - Site</title></head><body>
      <div class="main-col"><h2> Volume 1   Chapter 2: Opening </h2><article><p>${prose(15)}</p></article></div></body></html>`;
    expect(extractChapter("https://x.test/c/2", html).title).toBe("Volume 1 Chapter 2: Opening");
  });

  it("uses the leading heading as title and removes it from the content", () => {
    const html = `<html><head><title>Raw Title</title></head><body><article>
      <h2>Chương 5: Mở đầu</h2><p>${prose(15)}</p></article></body></html>`;
    const ch = extractChapter("https://x.test/c/5", html);
    expect(ch.title).toBe("Chương 5: Mở đầu");
    expect(ch.blocks.some((b) => b.type === "heading" && b.text === "Chương 5: Mở đầu")).toBe(false);
  });

  it("falls back to the <title> when there is no heading", () => {
    const html = `<html><head><title>Story - Chương 9 - Site</title></head><body><article><p>${prose(15)}</p></article></body></html>`;
    expect(extractChapter("https://x.test/c/9", html).title).toBe("Story - Chương 9 - Site");
  });

  it("unhides truyenfull #chapter-c and drops the ads-unlock overlay", () => {
    const html = `<html><head><title>T</title></head><body>
      <div class="ads-unlock-container"><p>UNLOCK-AD</p></div>
      <div id="chapter-c" style="display:none"><p>${prose(15)}</p></div></body></html>`;
    const ch = extractChapter("https://truyenfull.live/a/chuong-1/", html);
    const text = ch.blocks.map((b) => b.text).join(" ");
    expect(text).toContain("Nội dung truyện");
    expect(text).not.toContain("UNLOCK-AD");
  });

  it("throws LockedContentError for an anti-adblock notice", () => {
    const html = `<html><head><title>T</title></head><body><article><p>Nội dung chương đang bị khóa. ${prose(15)}</p></article></body></html>`;
    expect(() => extractChapter("https://x.test/c/1", html)).toThrow(LockedContentError);
    const html2 = `<html><head><title>T</title></head><body><article><p>Vui lòng tắt chặn quảng cáo để đọc. ${prose(15)}</p></article></body></html>`;
    expect(() => extractChapter("https://x.test/c/1", html2)).toThrow(LockedContentError);
  });

  it("throws when nothing can be extracted", () => {
    expect(() => extractChapter("https://x.test/c/1", "")).toThrow(/x\.test/);
  });
});

describe("lock errors", () => {
  it("SubscribersOnlyError and MatureContentError are LockedContentErrors", () => {
    expect(new SubscribersOnlyError("x")).toBeInstanceOf(LockedContentError);
    expect(new MatureContentError("x")).toBeInstanceOf(LockedContentError);
    expect(new LockedContentError("x")).not.toBeInstanceOf(SubscribersOnlyError);
  });
});
