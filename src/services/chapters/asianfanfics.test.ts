import { describe, expect, it, vi } from "vitest";
import { LockedContentError } from "../extractor";
import { BlankedPageError, renderPageHtml } from "../renderer";
import { fetchAsianfanficsChapter, parseAsianfanficsChapter } from "./asianfanfics";

vi.mock("../renderer", () => ({
  renderPageHtml: vi.fn(),
  BlankedPageError: class BlankedPageError extends Error {},
}));

const mockedRender = vi.mocked(renderPageHtml);

const CHAPTER_URL = "https://www.asianfanfics.com/story/view/1143593/1/attraction";

// Mirrors the rendered chapter page: content swapped in by htmx into a div that keeps its
// hx-get, with the site's cover-image div and load-error notice around it.
const chapterPage = (content: string, options: { extra?: string } = {}) => `<!doctype html>
<html><head><title>Lost in memories — Attraction - Asianfanfics</title></head>
<body>
<main>
  <header class="flow-root">
    <h1 class="mt-0 text-2xl font-bold">Lost in memories </h1>
    <div><span>by</span> <a href="/profile/u/haruaerin">haruaerin</a></div>
  </header>
  <div id="bodyText" class="prose">
    <div class="mb-4 text-center"><img src="https://photo.asianfanfics.com/story_cover/1143593_97ad6b.jpg" alt=""></div>
    <div hx-get="/htmx/chapter/3802873/ZyhNCUleeXQY2SKS" hx-trigger="load" hx-swap="innerHTML">${content}</div>
    <div id="content-load-error" class="hidden">This content couldn&#39;t be loaded.</div>
  </div>
</main>
${options.extra ?? ""}
</body></html>`;

describe("parseAsianfanficsChapter", () => {
  it("lấy tiêu đề từ h1 và nội dung từ div htmx", () => {
    const chapter = parseAsianfanficsChapter(
      chapterPage(
        `<p><span><span>It was raining heavily as I sat by the window.</span></span></p><p>A lot of thoughts were running through my mind…</p>`
      ),
      CHAPTER_URL
    );
    expect(chapter.title).toBe("Lost in memories");
    expect(chapter.sourceUrl).toBe(CHAPTER_URL);
    expect(chapter.blocks).toHaveLength(2);
    expect(chapter.blocks[0].text).toContain("It was raining heavily");
  });

  it("giữ ảnh và heading trong nội dung", () => {
    const chapter = parseAsianfanficsChapter(
      chapterPage(
        `<h2>Part two</h2><p>Text</p><figure><img src="https://i.imgur.com/a.jpg" alt="scene"><figcaption>Scene</figcaption></figure>`
      ),
      CHAPTER_URL
    );
    expect(chapter.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "image", "paragraph"]);
    expect(chapter.blocks[2].src).toBe("https://i.imgur.com/a.jpg");
  });

  it("bỏ qua ảnh bìa của site (nằm ngoài div nội dung)", () => {
    const chapter = parseAsianfanficsChapter(chapterPage(`<p>Only text</p>`), CHAPTER_URL);
    expect(chapter.blocks.some((b) => b.src?.includes("story_cover"))).toBe(false);
  });

  it("nội dung rỗng + có gate 18+ → LockedContentError", () => {
    const html = chapterPage("", { extra: `<div>You are trying to access: Chapter 1 <p>Are you over 18?</p></div>` });
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).toThrow(LockedContentError);
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).toThrow(/rated M/);
  });

  it("nội dung rỗng + subscribers only → LockedContentError", () => {
    const html = chapterPage("", { extra: `<div>Subscribers only</div>` });
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).toThrow(LockedContentError);
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).toThrow(/subscribers only/);
  });

  it("nội dung rỗng + trang Cloudflare → BlankedPageError (thử lại ngay)", () => {
    const html = '<html><head><title>Just a moment...</title></head><body>Performing security verification</body></html>';
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).toThrow(BlankedPageError);
  });

  it("nội dung rỗng không rõ nguyên nhân → lỗi có thể thử lại", () => {
    expect(() => parseAsianfanficsChapter(chapterPage(""), CHAPTER_URL)).toThrow(/Could not find chapter content/);
  });
});

describe("fetchAsianfanficsChapter", () => {
  it("render trang chương rồi trả nội dung", async () => {
    mockedRender.mockResolvedValueOnce(chapterPage(`<p><span><span>Chapter text</span></span></p>`));
    const chapter = await fetchAsianfanficsChapter(CHAPTER_URL);
    expect(mockedRender).toHaveBeenCalledWith(CHAPTER_URL);
    expect(chapter.title).toBe("Lost in memories");
    expect(chapter.blocks).toHaveLength(1);
  });
});
