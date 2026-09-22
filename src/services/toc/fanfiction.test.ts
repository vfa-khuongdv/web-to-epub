import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderPageHtml } from "../renderer";
import {
  fetchToc,
  normalizeFanfictionStoryUrl,
  parseFanfictionStoryId,
  parseStoryPage,
} from "./fanfiction";

vi.mock("../renderer", () => ({ renderPageHtml: vi.fn() }));

const mockedRender = vi.mocked(renderPageHtml);

beforeEach(() => {
  mockedRender.mockReset();
});

const STORY_SLUG = "Harry-Potter-and-the-Methods-of-Rationality";

// Real markup: the dropdown's own onchange always builds '/s/<id>/'+value+'/<story-slug>' —
// that's the canonical slug every chapter URL must carry (see fanfiction.ts's canonicalSlug).
const chapSelectHtml = (slug = STORY_SLUG) =>
  `<select id="chap_select" name="chapter" onchange="self.location = '/s/5782108/'+ this.options[this.selectedIndex].value + '/${slug}';"><option value="1" selected="">1. A Day of Very Low Probability</option><option value="2">2. Everything I Believe Is False</option></select>`;

// The dropdown is repeated in the page's top and bottom chapter nav; parseStoryPage must dedupe.
const storyPage = (options: { title?: string; chapSelect?: string; extra?: string } = {}) => `<!doctype html>
<html><head><title>${options.title ?? "HPMOR"} - FanFiction</title></head>
<body>
<div id="profile_top" style="min-height:112px;">
  <img class="cimage " src="/image/80871/75/" width="75" height="100">
  <b class="xcontrast_txt">${options.title ?? "Harry Potter and the Methods of Rationality"}</b>
  <span class="xcontrast_txt">By:</span> <a class="xcontrast_txt" href="/u/2269863/Less-Wrong">Less Wrong</a>
  <span class="xgray xcontrast_txt">Rated: <a href="https://www.fictionratings.com/">Fiction  M</a></span>
</div>
<div class="lc-wrapper">${options.chapSelect ?? chapSelectHtml()}</div>
<div id="storytext" class="storytext">${options.extra ?? "<p>Chapter text.</p>"}</div>
<div class="lc-wrapper">${options.chapSelect ?? chapSelectHtml()}</div>
</body></html>`;

describe("parseFanfictionStoryId", () => {
  it("đọc id từ URL truyện và URL chương", () => {
    expect(parseFanfictionStoryId("https://www.fanfiction.net/s/5782108/")).toBe("5782108");
    expect(parseFanfictionStoryId("https://www.fanfiction.net/s/5782108/1/Harry-Potter")).toBe("5782108");
    expect(parseFanfictionStoryId("https://www.fanfiction.net/s/5782108/122/Something")).toBe("5782108");
  });

  it("trả undefined cho URL không phải trang truyện", () => {
    expect(parseFanfictionStoryId("https://www.fanfiction.net/book/Harry-Potter/")).toBeUndefined();
    expect(parseFanfictionStoryId("khong-phai-url")).toBeUndefined();
  });
});

describe("normalizeFanfictionStoryUrl", () => {
  it("về chương 1, www + https, giữ nguyên slug nếu URL đầu vào có", () => {
    expect(normalizeFanfictionStoryUrl(`http://fanfiction.net/s/5782108/58/${STORY_SLUG}`)).toBe(
      `https://www.fanfiction.net/s/5782108/1/${STORY_SLUG}`
    );
  });

  it("URL đầu vào không có slug thì giữ nguyên không có slug", () => {
    expect(normalizeFanfictionStoryUrl("https://www.fanfiction.net/s/5782108/")).toBe(
      "https://www.fanfiction.net/s/5782108/1/"
    );
  });

  it("giữ nguyên URL không phải trang truyện (fetchToc sẽ báo lỗi rõ ràng)", () => {
    expect(normalizeFanfictionStoryUrl("https://www.fanfiction.net/book/Harry-Potter/")).toBe(
      "https://www.fanfiction.net/book/Harry-Potter/"
    );
  });
});

describe("parseStoryPage", () => {
  const url = `https://www.fanfiction.net/s/5782108/1/${STORY_SLUG}`;

  it("lấy title/author/cover", () => {
    const toc = parseStoryPage(storyPage(), url);
    expect(toc.title).toBe("Harry Potter and the Methods of Rationality");
    expect(toc.author).toBe("Less Wrong");
    expect(toc.coverUrl).toBe("https://www.fanfiction.net/image/80871/75/");
  });

  it("liệt kê chương từ dropdown kèm slug chuẩn (đọc từ onchange), gỡ trùng nav trên/dưới, bỏ số thứ tự do site tự thêm", () => {
    const toc = parseStoryPage(storyPage(), url);
    expect(toc.chapters).toEqual([
      { url: `https://www.fanfiction.net/s/5782108/1/${STORY_SLUG}`, title: "A Day of Very Low Probability" },
      { url: `https://www.fanfiction.net/s/5782108/2/${STORY_SLUG}`, title: "Everything I Believe Is False" },
    ]);
  });

  it("URL chương không có slug từng bị site trả lỗi ngẫu nhiên (đã xác minh trên truyện thật) — luôn ghép slug chuẩn thay vì để trống", () => {
    // Regression: the site intermittently served "outdated url" for a bare /<id>/<n>/
    // request even for a real, existing chapter — resolved every time once the slug was
    // present. parseStoryPage must never emit a slug-less chapter URL when one is known.
    const toc = parseStoryPage(storyPage(), url);
    expect(toc.chapters.every((c) => c.url.endsWith(`/${STORY_SLUG}`))).toBe(true);
  });

  it("tên chương của tác giả trùng số vị trí khác (vd tác giả đặt tên 'Chapter 1' cho vị trí 2) vẫn tách đúng, không lẫn với cột thứ tự riêng của app", () => {
    const chapSelect = `<select id="chap_select" onchange="self.location = '/s/5782108/'+ this.options[this.selectedIndex].value + '/${STORY_SLUG}';"><option value="1">1. Prologue</option><option value="2" selected="">2. Chapter 1</option></select>`;
    const toc = parseStoryPage(storyPage({ chapSelect }), url);
    expect(toc.chapters).toEqual([
      { url: `https://www.fanfiction.net/s/5782108/1/${STORY_SLUG}`, title: "Prologue" },
      { url: `https://www.fanfiction.net/s/5782108/2/${STORY_SLUG}`, title: "Chapter 1" },
    ]);
  });

  it("truyện one-shot (không có dropdown) trả 1 chương là chính trang truyện, slug lấy từ URL trang", () => {
    const toc = parseStoryPage(storyPage({ chapSelect: "" }), url);
    expect(toc.chapters).toEqual([
      {
        url: `https://www.fanfiction.net/s/5782108/1/${STORY_SLUG}`,
        title: "Harry Potter and the Methods of Rationality",
      },
    ]);
  });

  it("one-shot mà URL trang cũng không có slug thì chương trả về không có slug (không có nguồn nào để lấy)", () => {
    const toc = parseStoryPage(storyPage({ chapSelect: "" }), "https://www.fanfiction.net/s/5782108/1/");
    expect(toc.chapters).toEqual([
      { url: "https://www.fanfiction.net/s/5782108/1/", title: "Harry Potter and the Methods of Rationality" },
    ]);
  });

  it("thiếu #profile_top thì title là Untitled", () => {
    const toc = parseStoryPage("<html><body></body></html>", url);
    expect(toc.title).toBe("Untitled");
    expect(toc.chapters).toEqual([]);
  });
});

describe("fetchToc (fanfiction.net)", () => {
  const storyUrl = `https://www.fanfiction.net/s/5782108/1/${STORY_SLUG}`;

  it("render trang chương 1 (đã chuẩn hoá URL, giữ slug) rồi trả mục lục", async () => {
    mockedRender.mockResolvedValueOnce(storyPage());
    const toc = await fetchToc(storyUrl);
    expect(mockedRender).toHaveBeenCalledWith(`https://www.fanfiction.net/s/5782108/1/${STORY_SLUG}`);
    expect(toc.chapters).toHaveLength(2);
  });

  it("thử lại khi lần đầu gặp trang kiểm tra bot của Cloudflare", async () => {
    mockedRender
      .mockResolvedValueOnce('<html><head><title>Just a moment...</title></head><body>Performing security verification</body></html>')
      .mockResolvedValueOnce(storyPage());
    const toc = await fetchToc(storyUrl);
    expect(mockedRender).toHaveBeenCalledTimes(2);
    expect(toc.chapters).toHaveLength(2);
  });

  it("báo lỗi khi truyện không tồn tại (không thử lại)", async () => {
    mockedRender.mockResolvedValue(
      '<html><body><span class="gui_warning">Story Not Found<hr>Story is unavailable for reading. (A)</span></body></html>'
    );
    await expect(fetchToc(storyUrl)).rejects.toThrow(/Story not found on FanFiction.net/);
    expect(mockedRender).toHaveBeenCalledTimes(1);
  });

  it("báo lỗi khi không có mục lục và không rõ nguyên nhân", async () => {
    mockedRender.mockResolvedValue(storyPage({ chapSelect: "", extra: "" }));
    await expect(fetchToc(storyUrl)).rejects.toThrow(/No chapter list found/);
    expect(mockedRender).toHaveBeenCalledTimes(4);
  });

  it("Cloudflare không xác minh xong → lỗi nói rõ là thử lại được", async () => {
    mockedRender.mockResolvedValue(
      '<html><head><title>Just a moment...</title></head><body>Performing security verification</body></html>'
    );
    await expect(fetchToc(storyUrl)).rejects.toThrow(/Cloudflare verification did not finish/);
    expect(mockedRender).toHaveBeenCalledTimes(4);
  });
});
