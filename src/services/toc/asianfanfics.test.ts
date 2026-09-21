import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderPageHtml } from "../renderer";
import {
  fetchToc,
  normalizeAsianfanficsStoryUrl,
  parseAsianfanficsStoryId,
  parseStoryPage,
} from "./asianfanfics";

vi.mock("../renderer", () => ({ renderPageHtml: vi.fn() }));

const mockedRender = vi.mocked(renderPageHtml);

beforeEach(() => {
  mockedRender.mockReset();
});

const TOC_LINKS = `
  <a href="/story/view/1143593/attraction" data-toc-chapter="0" data-title="foreword">
    <span class="truncate">Foreword</span>
  </a>
  <div data-toc-row data-title="lost in memories">
    <a href="/story/view/1143593/1/attraction" data-toc-chapter="1">
      <span class="flex size-6 items-center justify-center rounded-full">1</span>
      <span class="truncate">Lost in memories</span>
    </a>
  </div>
  <div data-toc-row data-title="who really are you...?">
    <a href="/story/view/1143593/2/attraction" data-toc-chapter="2">
      <span class="flex size-6 items-center justify-center rounded-full">2</span>
      <span class="truncate">Who really are you...?</span>
      <span class="rounded-full bg-[#fdeef2] px-1.5 py-0.5">M</span>
    </a>
  </div>`;

// The mobile TOC sheet repeats the same links; parseStoryPage must dedupe them.
const storyPage = (options: { title?: string; badges?: string; toc?: string; extra?: string } = {}) => `<!doctype html>
<html><head><title>${options.title ?? "Attraction"} - Asianfanfics</title></head>
<body>
<header data-aff-userbar-shell><a href="/login">Log In</a> <a href="/register">Register</a></header>
<div id="main-container">
  <div class="relative isolate"><div class="relative z-10">
    <main class="min-w-0">
      <header class="flow-root">
        <img src="https://photo.asianfanfics.com/story_cover/1143593_97ad6b.jpg" alt="" loading="lazy">
        <h1 class="mt-0 text-2xl font-bold">${options.title ?? "Attraction"} </h1>
        <div class="mt-2 flex flex-wrap gap-1.5">${options.badges ?? ""}</div>
        <div class="mt-2 flex items-center gap-x-1.5">
          <span>by</span> <a href="/profile/u/haruaerin" class="font-semibold">haruaerin</a>
        </div>
        <p class="mt-2 text-xs"><span>3 chapters</span> <span>0 votes</span></p>
      </header>
      <div id="bodyText"></div>
    </main>
    <aside data-story-aside>
      <div data-toc><div data-toc-list>${options.toc ?? TOC_LINKS}</div></div>
      <div data-toc><div data-toc-list>${options.toc ?? TOC_LINKS}</div></div>
    </aside>
  </div></div>
</div>
${options.extra ?? ""}
</body></html>`;

describe("parseAsianfanficsStoryId", () => {
  it("đọc id từ URL truyện và URL chương", () => {
    expect(parseAsianfanficsStoryId("https://www.asianfanfics.com/story/view/1143593")).toBe("1143593");
    expect(parseAsianfanficsStoryId("https://www.asianfanfics.com/story/view/1143593/attraction")).toBe("1143593");
    expect(parseAsianfanficsStoryId("https://www.asianfanfics.com/story/view/1143593/1/attraction")).toBe("1143593");
  });

  it("trả undefined cho URL không phải trang truyện", () => {
    expect(parseAsianfanficsStoryId("https://www.asianfanfics.com/browse")).toBeUndefined();
    expect(parseAsianfanficsStoryId("https://www.asianfanfics.com/profile/u/haruaerin")).toBeUndefined();
    expect(parseAsianfanficsStoryId("khong-phai-url")).toBeUndefined();
  });
});

describe("normalizeAsianfanficsStoryUrl", () => {
  it("bỏ slug và số chương, luôn về www + https", () => {
    expect(normalizeAsianfanficsStoryUrl("http://asianfanfics.com/story/view/1143593/2/who-really-are-you")).toBe(
      "https://www.asianfanfics.com/story/view/1143593"
    );
    expect(normalizeAsianfanficsStoryUrl("https://www.asianfanfics.com/story/view/1143593/")).toBe(
      "https://www.asianfanfics.com/story/view/1143593"
    );
  });

  it("giữ nguyên URL không phải trang truyện (fetchToc sẽ báo lỗi rõ ràng)", () => {
    expect(normalizeAsianfanficsStoryUrl("https://www.asianfanfics.com/browse")).toBe(
      "https://www.asianfanfics.com/browse"
    );
  });
});

describe("parseStoryPage", () => {
  const url = "https://www.asianfanfics.com/story/view/1143593";

  it("lấy title/author/cover", () => {
    const toc = parseStoryPage(storyPage(), url);
    expect(toc.title).toBe("Attraction");
    expect(toc.author).toBe("haruaerin");
    expect(toc.coverUrl).toBe("https://photo.asianfanfics.com/story_cover/1143593_97ad6b.jpg");
  });

  it("liệt kê chương theo thứ tự, gồm Foreword, gỡ trùng desktop/mobile", () => {
    const toc = parseStoryPage(storyPage(), url);
    expect(toc.chapters.map((c) => c.url)).toEqual([
      "https://www.asianfanfics.com/story/view/1143593/attraction",
      "https://www.asianfanfics.com/story/view/1143593/1/attraction",
      "https://www.asianfanfics.com/story/view/1143593/2/attraction",
    ]);
  });

  it("lấy tên chương sạch: bỏ số thứ tự và badge M", () => {
    const toc = parseStoryPage(storyPage(), url);
    expect(toc.chapters.map((c) => c.title)).toEqual(["Foreword", "Lost in memories", "Who really are you...?"]);
  });

  it("trang không có chương (truyện M / subscribers only) trả danh sách rỗng", () => {
    const toc = parseStoryPage(storyPage({ badges: `<span>Subscribers only</span>`, toc: "" }), url);
    expect(toc.chapters).toEqual([]);
  });

  it("thiếu h1 thì title là Untitled", () => {
    const toc = parseStoryPage("<html><body><main><header></header></main></body></html>", url);
    expect(toc.title).toBe("Untitled");
  });
});

describe("fetchToc (asianfanfics)", () => {
  const storyUrl = "https://www.asianfanfics.com/story/view/1143593";

  it("render trang truyện rồi trả mục lục", async () => {
    mockedRender.mockResolvedValueOnce(storyPage());
    const toc = await fetchToc(storyUrl);
    expect(mockedRender).toHaveBeenCalledWith(storyUrl);
    expect(toc.chapters).toHaveLength(3);
  });

  it("thử lại khi lần đầu gặp trang kiểm tra bot của Cloudflare", async () => {
    mockedRender
      .mockResolvedValueOnce(
        '<html><head><title>Just a moment...</title></head><body>Performing security verification</body></html>'
      )
      .mockResolvedValueOnce(storyPage());
    const toc = await fetchToc(storyUrl);
    expect(mockedRender).toHaveBeenCalledTimes(2);
    expect(toc.chapters).toHaveLength(3);
  });

  it("thử lại khi renderer báo trang trắng", async () => {
    mockedRender.mockRejectedValueOnce(new Error("Page blanked before content could be read")).mockResolvedValueOnce(storyPage());
    const toc = await fetchToc(storyUrl);
    expect(mockedRender).toHaveBeenCalledTimes(2);
    expect(toc.chapters).toHaveLength(3);
  });

  it("báo lỗi rõ ràng cho truyện subscribers only (không thử lại)", async () => {
    mockedRender.mockResolvedValue(storyPage({ badges: `<span>Subscribers only</span>`, toc: "" }));
    await expect(fetchToc(storyUrl)).rejects.toThrow(/subscribers only/);
    expect(mockedRender).toHaveBeenCalledTimes(1);
  });

  it("báo lỗi rõ ràng cho truyện rated M (cần đăng nhập)", async () => {
    mockedRender.mockResolvedValue(storyPage({ toc: "", extra: "<p>Are you over 18?</p>" }));
    await expect(fetchToc(storyUrl)).rejects.toThrow(/rated M/);
    expect(mockedRender).toHaveBeenCalledTimes(1);
  });

  it("báo lỗi khi truyện không tồn tại", async () => {
    mockedRender.mockResolvedValue("<html><body><main><header><h1>Page Not Found</h1></header></main></body></html>");
    await expect(fetchToc(storyUrl)).rejects.toThrow(/Story not found on Asianfanfics/);
  });

  it("báo lỗi khi không có mục lục và không rõ nguyên nhân", async () => {
    mockedRender.mockResolvedValue(storyPage({ toc: "" }));
    await expect(fetchToc(storyUrl)).rejects.toThrow(/No chapter list found/);
    expect(mockedRender).toHaveBeenCalledTimes(3);
  });
});
