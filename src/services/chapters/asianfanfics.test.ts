import { describe, expect, it, vi } from "vitest";
import { LockedContentError } from "../extractor";
import { renderPageHtml } from "../renderer";
import { fetchAsianfanficsChapter, parseAsianfanficsChapter } from "./asianfanfics";

vi.mock("../renderer", () => ({
  renderPageHtml: vi.fn(),
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

  it("badge 'Subscribers only' trên header KHÔNG phải khoá: chương lỗi tạm thời vẫn thử lại được", () => {
    // Every page of a subscribers-only story carries that badge, readable or not. Treating
    // it as a lock would turn a failed content load into a permanent error with no retry.
    const html = chapterPage("", { extra: `<div><span>Subscribers only</span></div>` });
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).not.toThrow(LockedContentError);
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).toThrow(/Could not find chapter content/);
  });

  it("trang Cloudflare → lỗi tạm thời có thể thử lại, không phải LockedContentError", () => {
    const html = '<html><head><title>Just a moment...</title></head><body>Performing security verification</body></html>';
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).not.toThrow(LockedContentError);
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).toThrow(/Cloudflare verification did not finish/);
  });

  it("nội dung rỗng không rõ nguyên nhân → lỗi có thể thử lại", () => {
    expect(() => parseAsianfanficsChapter(chapterPage(""), CHAPTER_URL)).toThrow(/Could not find chapter content/);
  });

  it("không lấy nhầm section comments/feed làm nội dung chương", () => {
    // Shape of a page whose chapter body never arrived: the only htmx targets left are
    // other parts of the page. Their text must never be filed as the chapter.
    const html = `<!doctype html><html><body><main>
      <h1>Lost in memories</h1>
      <div id="bodyText">
        <div class="mb-4 text-center"><img src="https://photo.asianfanfics.com/story_cover/1.jpg" alt=""></div>
      </div>
      <section id="comments" hx-get="/htmx/story/comments/1143593?chapter=1">Bình luận: truyện hay quá, hóng chap mới!</section>
      <div hx-get="/htmx/story/author/1143593?return_to=%2F">Về tác giả</div>
      <div hx-get="/htmx/story/feed/1143593">Hoạt động</div>
    </main></body></html>`;
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).toThrow(/Could not find chapter content/);
  });

  it("teaser của truyện subscribers-only → LockedContentError, không lưu chương cụt", () => {
    // Real shape: the chapter container never loads; #bodyText holds a teaser (the first
    // paragraphs) plus the notice.
    const html = `<!doctype html><html><body><main>
      <h1>初次合作</h1>
      <div id="bodyText">
        <div class="mb-4 rounded-[3px] border border-dashed p-3 text-center font-semibold">Please subscribe to read further chapters.</div>
        <div hx-get="/htmx/teaser/5943590/token123">Phần đầu của chương mà tài khoản chưa đăng ký đọc được…</div>
        <div id="content-load-error" class="hidden">This content couldn't be loaded.</div>
      </div>
    </main></body></html>`;
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).toThrow(LockedContentError);
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).toThrow(/subscribers only/);
  });

  it("không cần notice tiếng Anh: chỉ cần div teaser là đủ", () => {
    // The site translates its notices; the teaser container is the language-independent signal.
    const html = `<!doctype html><html><body><main>
      <h1>初次合作</h1>
      <div id="bodyText"><div hx-get="/htmx/teaser/5943590/token123">请订阅以阅读更多章节。第一章的内容……</div></div>
    </main></body></html>`;
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL)).toThrow(LockedContentError);
  });

  it("foreword đọc từ /htmx/story/<id>/<token>", () => {
    const html = `<!doctype html><html><body><main>
      <h1>Attraction</h1>
      <div id="bodyText">
        <div hx-get="/htmx/story/1143593/tokenabc"><h2>Description</h2><p>A story about a girl.</p></div>
      </div>
    </main></body></html>`;
    const chapter = parseAsianfanficsChapter(html, "https://www.asianfanfics.com/story/view/1143593/attraction");
    expect(chapter.blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
  });

  it("phiên đã lưu nhưng trang trả về khách → báo phiên hết hạn", () => {
    const html = `<!doctype html><html><body>
      <header data-aff-userbar-shell><a href="/login">Log In</a> <a href="/register">Register</a></header>
      <main><h1>Purr-fect</h1>
        <div id="bodyText"><div class="mb-4">Please subscribe to read further chapters.</div><div hx-get="/htmx/teaser/1/tok">Đoạn đầu…</div></div>
      </main>
    </body></html>`;
    // With a saved session, the real reason is the expired login, not the guest-level lock.
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL, { sessionSaved: true })).toThrow(LockedContentError);
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL, { sessionSaved: true })).toThrow(/session has expired/);
    // Without a saved session it is a genuine guest lock and reads as such.
    expect(() => parseAsianfanficsChapter(html, CHAPTER_URL, { sessionSaved: false })).toThrow(/subscribers only/);
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
