import { describe, expect, it, vi } from "vitest";
import { renderPageHtml } from "../renderer";
import { fetchFanfictionChapter, parseFanfictionChapter } from "./fanfiction";

vi.mock("../renderer", () => ({
  renderPageHtml: vi.fn(),
}));

const mockedRender = vi.mocked(renderPageHtml);

const CHAPTER_URL = "https://www.fanfiction.net/s/5782108/1/Harry-Potter-and-the-Methods-of-Rationality";

const chapterPage = (storytext: string, options: { chapSelect?: string; extra?: string } = {}) => `<!doctype html>
<html><head><title>FanFiction</title></head>
<body>
<div id="profile_top">
  <b class="xcontrast_txt">Harry Potter and the Methods of Rationality</b>
  <span class="xcontrast_txt">By:</span> <a class="xcontrast_txt" href="/u/2269863/Less-Wrong">Less Wrong</a>
</div>
<select id="chap_select">${
  options.chapSelect ?? `<option value="1" selected="">1. A Day of Very Low Probability</option><option value="2">2. Everything I Believe Is False</option>`
}</select>
<div id="storytext" class="storytext nocopy">${storytext}</div>
${options.extra ?? ""}
</body></html>`;

describe("parseFanfictionChapter", () => {
  it("lấy tiêu đề từ option đang chọn và nội dung từ #storytext", () => {
    const chapter = parseFanfictionChapter(
      chapterPage("<p>Disclaimer: not mine.</p><p>Second paragraph.</p>"),
      CHAPTER_URL
    );
    expect(chapter.title).toBe("A Day of Very Low Probability");
    expect(chapter.sourceUrl).toBe(CHAPTER_URL);
    expect(chapter.blocks).toHaveLength(2);
    expect(chapter.blocks[0].text).toContain("Disclaimer");
  });

  it("tên chương của tác giả trùng số vị trí khác (vd 'Chapter 1' ở vị trí 2) vẫn tách đúng số do site tự thêm", () => {
    const chapter = parseFanfictionChapter(
      chapterPage("<p>Text.</p>", { chapSelect: `<option value="1">1. Prologue</option><option value="2" selected="">2. Chapter 1</option>` }),
      CHAPTER_URL
    );
    expect(chapter.title).toBe("Chapter 1");
  });

  it("truyện one-shot (không dropdown) lấy tiêu đề từ title truyện", () => {
    const chapter = parseFanfictionChapter(chapterPage("<p>Only chapter.</p>", { chapSelect: "" }), CHAPTER_URL);
    expect(chapter.title).toBe("Harry Potter and the Methods of Rationality");
  });

  it("giữ định dạng inline (in đậm/nghiêng) trong đoạn văn", () => {
    const chapter = parseFanfictionChapter(chapterPage("<p><strong>Bold</strong> and <em>italic</em>.</p>"), CHAPTER_URL);
    expect(chapter.blocks[0].text).toBe("<strong>Bold</strong> and <em>italic</em>.");
  });

  it("nội dung rỗng + truyện không tồn tại → báo rõ", () => {
    const html = chapterPage("", {
      extra: `<span class="gui_warning">Story Not Found<hr>Story is unavailable for reading. (A)</span>`,
    });
    expect(() => parseFanfictionChapter(html, CHAPTER_URL)).toThrow(/Story not found on FanFiction.net/);
  });

  it("site báo tạm thời 'không có chương' cho một chương thật sự tồn tại → báo rõ là lỗi tạm thời, không đổ lỗi cấu trúc trang", () => {
    // Real shape confirmed flaky, not a dead URL: the exact same slugged URL failed 6/6 in
    // a row, then the same chapter succeeded later with no change on our end — site-side
    // intermittency, so the message must not claim the chapter is permanently gone.
    const html = chapterPage("", {
      extra: `<span class="gui_normal">FanFiction.Net Message Type 1<hr>Story does not have any chapters. Please check to see you are not using an outdated url.</span>`,
    });
    expect(() => parseFanfictionChapter(html, CHAPTER_URL)).toThrow(/temporary/);
  });

  it("trang Cloudflare → lỗi tạm thời có thể thử lại", () => {
    const html = '<html><head><title>Just a moment...</title></head><body>Performing security verification</body></html>';
    expect(() => parseFanfictionChapter(html, CHAPTER_URL)).toThrow(/Cloudflare verification did not finish/);
  });

  it("nội dung rỗng không rõ nguyên nhân → lỗi có thể thử lại", () => {
    expect(() => parseFanfictionChapter(chapterPage(""), CHAPTER_URL)).toThrow(/Could not find chapter content/);
  });
});

describe("fetchFanfictionChapter", () => {
  it("render trang chương rồi trả nội dung", async () => {
    mockedRender.mockResolvedValueOnce(chapterPage("<p>Chapter text.</p>"));
    const chapter = await fetchFanfictionChapter(CHAPTER_URL);
    expect(mockedRender).toHaveBeenCalledWith(CHAPTER_URL);
    expect(chapter.title).toBe("A Day of Very Low Probability");
    expect(chapter.blocks).toHaveLength(1);
  });
});
