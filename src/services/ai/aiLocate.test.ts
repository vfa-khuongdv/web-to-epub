import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./aiConfig", () => ({ activeAiProvider: vi.fn() }));
vi.mock("../renderer", () => ({ renderPageHtml: vi.fn() }));
vi.mock("../toc/http", () => ({ fetchWithRetry: vi.fn() }));

import { activeAiProvider } from "./aiConfig";
import { renderPageHtml } from "../renderer";
import { fetchWithRetry } from "../toc/http";
import { LockedContentError } from "../extractor";
import {
  AiNotConfiguredError,
  createAiTocAdapter,
  extractChapterWithAi,
  fetchChapterWithAi,
  forgetReadingModes,
  parseTocWithAi,
} from "./aiLocate";
import type { AiProvider } from "./providers";

const prose = "Câu chuyện tiếp tục ở đây với nhiều chữ. ".repeat(20);
const chapterHtml = (extra = "") =>
  `<html><head><title>T</title></head><body><h1>Chương 1</h1><div id="c"><p>${prose}</p><p>Hai.</p></div>${extra}<!-- ${"pad ".repeat(600)} --></body></html>`;
const respond = (html: string, status = 200) => ({ ok: status < 400, status, text: async () => html }) as unknown as Response;

// Picks the first body, answers "none"/"whole" to the rest, and records every question asked.
const asked: string[] = [];
const provider: AiProvider = {
  choose: async (q, _s, o) => {
    asked.push(q);
    if ("title1" in o) return "none";
    if ("body1" in o) return "body1";
    if ("plain" in o) return "plain";
    return "whole" in o ? "whole" : Object.keys(o)[0];
  },
};

beforeEach(() => {
  asked.length = 0;
  forgetReadingModes();
  vi.mocked(activeAiProvider).mockReturnValue(provider);
  vi.mocked(fetchWithRetry).mockReset();
  vi.mocked(renderPageHtml).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("AI crawler not configured", () => {
  it("fetchChapterWithAi refuses without a provider", async () => {
    vi.mocked(activeAiProvider).mockReturnValue(undefined);
    await expect(fetchChapterWithAi("https://x.test/c/1")).rejects.toBeInstanceOf(AiNotConfiguredError);
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("the TOC adapter refuses without a provider and passes story URLs through", async () => {
    vi.mocked(activeAiProvider).mockReturnValue(undefined);
    const adapter = createAiTocAdapter();
    expect(adapter.domains).toEqual([]);
    expect(adapter.normalizeStoryUrl("https://x.test/s?a=1")).toBe("https://x.test/s?a=1");
    await expect(adapter.fetchToc("https://x.test/s")).rejects.toBeInstanceOf(AiNotConfiguredError);
  });
});

describe("extractChapterWithAi edge cases", () => {
  it("asks why a near-empty page is empty and reports a login wall as locked", async () => {
    const wall: AiProvider = { choose: async () => "locked" };
    await expect(extractChapterWithAi(wall, "https://x.test/c/1", "<body><p>Đăng nhập</p></body>")).rejects.toBeInstanceOf(
      LockedContentError
    );
  });

  it("fails with a plain error when an empty page is just empty", async () => {
    const empty: AiProvider = { choose: async () => "empty" };
    const err = await extractChapterWithAi(empty, "https://x.test/c/1", "<body></body>").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LockedContentError);
    expect(String(err.message)).toContain("https://x.test/c/1");
  });

  it("drops script/style text and keeps chapter paragraphs from the DOM", async () => {
    const chapter = await extractChapterWithAi(provider, "https://x.test/c/1", chapterHtml("<script>var leaked=1</script>"));
    expect(chapter.blocks.map((b) => b.text).join(" ")).not.toContain("leaked");
    expect(chapter.blocks.at(-1)?.text).toBe("Hai.");
    expect(chapter.sourceUrl).toBe("https://x.test/c/1");
  });
});

describe("parseTocWithAi", () => {
  it("throws when the page has no group of chapter links at all", async () => {
    await expect(parseTocWithAi(provider, "https://x.test/s", "<body><p>nothing</p></body>")).rejects.toThrow();
  });
});

describe("fetchChapterWithAi", () => {
  it("reads the plain page and, when the browser reading is identical, asks no comparison", async () => {
    const html = chapterHtml();
    vi.mocked(fetchWithRetry).mockResolvedValue(respond(html));
    vi.mocked(renderPageHtml).mockResolvedValue(html);
    const ch = await fetchChapterWithAi("https://x.test/c/1");
    expect(ch.blocks.length).toBe(2);
    expect(asked.some((q) => q.startsWith("These are two readings"))).toBe(false);
  });

  it("lets the AI choose the browser reading when the two differ, and remembers it per host", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(respond(chapterHtml()));
    // the browser version has an extra paragraph
    vi.mocked(renderPageHtml).mockResolvedValue(chapterHtml().replace("<p>Hai.</p>", "<p>Hai.</p><p>Ba.</p>"));
    const chooser: AiProvider = {
      choose: async (q, s, o) => ("plain" in o && "browser" in o ? "browser" : provider.choose(q, s, o)),
    };
    vi.mocked(activeAiProvider).mockReturnValue(chooser);

    const first = await fetchChapterWithAi("https://x.test/c/1");
    expect(first.blocks.at(-1)?.text).toBe("Ba.");

    // the second chapter of the host goes straight to the browser, no plain fetch
    vi.mocked(fetchWithRetry).mockClear();
    const second = await fetchChapterWithAi("https://x.test/c/2");
    expect(second.blocks.at(-1)?.text).toBe("Ba.");
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("falls back to the browser when the plain page fails, but not when it is locked", async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(new Error("net"));
    vi.mocked(renderPageHtml).mockResolvedValue(chapterHtml());
    const ch = await fetchChapterWithAi("https://x.test/c/1");
    expect(ch.blocks.length).toBe(2);

    forgetReadingModes();
    vi.mocked(fetchWithRetry).mockResolvedValue(respond(chapterHtml()));
    vi.mocked(renderPageHtml).mockClear();
    vi.mocked(activeAiProvider).mockReturnValue({ choose: async () => "locked" });
    await expect(fetchChapterWithAi("https://y.test/c/1")).rejects.toBeInstanceOf(LockedContentError);
    expect(renderPageHtml).not.toHaveBeenCalled();
  });

  it("propagates a server error from the plain page by trying the browser instead", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(respond("oops", 503));
    vi.mocked(renderPageHtml).mockResolvedValue(chapterHtml());
    const ch = await fetchChapterWithAi("https://z.test/c/1");
    expect(ch.blocks.length).toBe(2);
    expect(renderPageHtml).toHaveBeenCalled();
  });
});

describe("a chapter list split over pages", () => {
  const pad = `<!-- ${"pad ".repeat(600)} -->`;
  const page = (chapters: number[]) =>
    `<html><head><title>Truyện</title></head><body><h1>Truyện</h1><ul>${chapters
      .map((n) => `<li><a href="/s/chuong-${n}/">Chương ${n}</a></li>`)
      .join("")}</ul><div class="pager"><a href="/s/trang-2/">2</a><a href="/s/trang-3/">3</a></div><a href="/top/100-500-chuong">100 - 500 chương</a>${pad}</body></html>`;
  const pages: Record<string, string> = {
    "https://x.test/s/": page([1, 2, 3]),
    "https://x.test/s/trang-2/": page([4, 5, 6]),
    "https://x.test/s/trang-3/": page([7, 8, 9]),
  };

  it("reads the further pages even when the AI picks the wrong group of links for them", async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (url) => respond(pages[String(url)] ?? "", pages[String(url)] ? 200 : 404));
    vi.mocked(activeAiProvider).mockReturnValue({
      choose: async (_q, _s, o) => {
        if ("part" in o) return "part";
        if ("links1" in o) return "links2"; // the "100 - 500 chương" link, not the pager
        if ("list1" in o) return "list1";
        return "none" in o ? "none" : Object.keys(o)[0];
      },
    });
    const toc = await createAiTocAdapter().fetchToc("https://x.test/s/");
    expect(toc.chapters.map((c) => c.url.replace("https://x.test/s/", ""))).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `chuong-${n}/`)
    );
  });
});
