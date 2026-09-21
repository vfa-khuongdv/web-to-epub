import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeStoryUrl } from "./normalizeUrl";
import { fetchText } from "./http";
import { fetchToc, parseChapterLinks, parseStoryMeta, parseTotalPages } from "./truyenfullTemplate";

vi.mock("./http", () => ({ fetchText: vi.fn() }));

// JSDOM construction dominates the long pagination test (~10ms per page), so identical
// HTML reuses one parsed document. Every distinct fixture/page shape still goes through
// real JSDOM once; only repeated pages (2..N share the same body) are cached. The real
// package is loaded with createRequire so mocking it doesn't inline all of jsdom into
// Vitest's transform pipeline.
vi.mock("jsdom", async () => {
  const { createRequire } = await import("node:module");
  const actual = createRequire(import.meta.url)("jsdom") as typeof import("jsdom");
  const cache = new Map<string, InstanceType<typeof actual.JSDOM>>();
  const CachedJSDOM = function JSDOM(html: string, options?: ConstructorParameters<typeof actual.JSDOM>[1]) {
    const hit = cache.get(html);
    if (hit) return hit;
    const doc = new actual.JSDOM(html, options);
    cache.set(html, doc);
    return doc;
  } as unknown as typeof actual.JSDOM;
  return { ...actual, JSDOM: CachedJSDOM };
});

const mockedFetchText = vi.mocked(fetchText);

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");
const nfc = (s: string) => s.normalize("NFC");

const chapterPage = (hrefs: string[]) =>
  `<html><body><div id="list-chapter"><ul class="list-chapter">${hrefs
    .map((href) => `<li><a href="${href}">${href}</a></li>`)
    .join("")}</ul></div></body></html>`;

beforeEach(() => {
  mockedFetchText.mockReset();
});

describe("parseStoryMeta (template truyenfull)", () => {
  it("truyenfull.live: title/author/cover", () => {
    const meta = parseStoryMeta(readFixture("truyenfull-story.html"), "https://truyenfull.live/dau-xuan-tuoi-sang/");
    expect(nfc(meta.title)).toBe("Đầu Xuân Tươi Sáng");
    expect(nfc(meta.author!)).toBe("Cô Nương Đừng Khóc");
    expect(meta.coverUrl?.startsWith("https://lh3.googleusercontent.com")).toBe(true);
  });

  it("truyencom.com: title lấy từ h1", () => {
    const meta = parseStoryMeta(readFixture("truyencom-story.html"), "https://truyencom.com/de-ba.27/");
    expect(nfc(meta.title)).toBe("Đế Bá");
    expect(nfc(meta.author!)).toBe("Yếm Bút Tiêu Sinh");
  });

  it("fallback title theo <title> khi không có h3/h1, thiếu author/cover", () => {
    const meta = parseStoryMeta(
      "<html><head><title>Tên Truyện - Site</title></head><body></body></html>",
      "https://truyenfull.live/a/"
    );
    expect(meta.title).toBe("Tên Truyện");
    expect(meta.author).toBeUndefined();
    expect(meta.coverUrl).toBeUndefined();
  });

  it('fallback title về "Untitled" khi trang trống', () => {
    const meta = parseStoryMeta("<html><body></body></html>", "https://truyenfull.live/a/");
    expect(meta.title).toBe("Untitled");
  });

  it("cover tương đối được ghép với pageUrl", () => {
    const meta = parseStoryMeta(
      '<html><body><img itemprop="image" src="/covers/x.jpg"></body></html>',
      "https://truyenfull.live/a/"
    );
    expect(meta.coverUrl).toBe("https://truyenfull.live/covers/x.jpg");
  });

  it("cover hỏng (URL không hợp lệ) trả undefined thay vì ném lỗi", () => {
    const meta = parseStoryMeta(
      '<html><body><img itemprop="image" src="http://["><h1>A</h1></body></html>',
      "https://truyenfull.live/a/"
    );
    expect(meta.title).toBe("A");
    expect(meta.coverUrl).toBeUndefined();
  });
});

describe("parseChapterLinks", () => {
  it("truyenfull.live: 50 chương trang 1, giữ đúng thứ tự", () => {
    const chapters = parseChapterLinks(readFixture("truyenfull-story.html"), "https://truyenfull.live/dau-xuan-tuoi-sang/");
    expect(chapters).toHaveLength(50);
    expect(chapters[0].url).toBe("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-1/");
    expect(chapters[49].url).toBe("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-50/");
    expect(nfc(chapters[0].title)).toContain("Chương 1");
  });

  it("truyencom.com: 50 chương, href .html", () => {
    const chapters = parseChapterLinks(readFixture("truyencom-story.html"), "https://truyencom.com/de-ba.27/");
    expect(chapters).toHaveLength(50);
    expect(chapters[0].url).toBe("https://truyencom.com/de-ba/chuong-1.html");
  });

  it("bỏ href trùng, bỏ href không hợp lệ, anchor rỗng lấy URL làm title", () => {
    const html = `<html><body><div id="list-chapter"><ul class="list-chapter">
      <li><a href="/a/chuong-1/">Chương   1</a></li>
      <li><a href="/a/chuong-1/">Chương 1 lặp lại</a></li>
      <li><a href="http://[">Hỏng</a></li>
      <li><a href="/a/chuong-2/"></a></li>
    </ul></div></body></html>`;

    const chapters = parseChapterLinks(html, "https://truyenfull.live/a/");

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({ url: "https://truyenfull.live/a/chuong-1/", title: "Chương 1" });
    expect(chapters[1]).toEqual({ url: "https://truyenfull.live/a/chuong-2/", title: "https://truyenfull.live/a/chuong-2/" });
  });
});

describe("parseTotalPages", () => {
  it("đọc #total-page khi trang chỉ có hidden input", () => {
    expect(parseTotalPages('<html><body><input id="total-page" type="hidden" value="3"></body></html>')).toBe(3);
  });

  it('#total-page = 0 hoặc không phải số thì suy ra từ link trang-', () => {
    expect(parseTotalPages('<html><body><input id="total-page" value="0"><a href="/a/trang-2/">2</a></body></html>')).toBe(2);
    expect(parseTotalPages('<html><body><input id="total-page" value="abc"><a href="/a/trang-5/">5</a></body></html>')).toBe(5);
  });

  it("không có phân trang trả undefined", () => {
    expect(parseTotalPages('<html><body><input id="total-page" value="abc"></body></html>')).toBeUndefined();
    expect(parseTotalPages("<html><body>không phân trang</body></html>")).toBeUndefined();
  });

  it("truyencom.com: suy ra từ pagination links", () => {
    expect(parseTotalPages(readFixture("truyencom-story.html"))).toBe(140);
  });
});

describe("fetchToc (template truyenfull)", () => {
  it("ghép chapter qua các trang trang-N/, bỏ URL trùng và dừng sớm khi trang không có chương mới", async () => {
    const base = "https://truyenfull.live/dau-xuan-tuoi-sang/";
    mockedFetchText
      .mockResolvedValueOnce(readFixture("truyenfull-story.html"))
      .mockResolvedValueOnce(chapterPage([`${base}chuong-1/`, `${base}chuong-51/`]))
      .mockResolvedValueOnce(chapterPage([`${base}chuong-51/`]));

    const toc = await fetchToc(base);

    expect(mockedFetchText).toHaveBeenCalledTimes(3);
    expect(mockedFetchText.mock.calls.map((c) => c[0])).toEqual([base, `${base}trang-2/`, `${base}trang-3/`]);
    expect(nfc(toc.title)).toBe("Đầu Xuân Tươi Sáng");
    expect(toc.chapters).toHaveLength(51);
    expect(new Set(toc.chapters.map((c) => c.url)).size).toBe(51);
    expect(toc.chapters[50].url).toBe(`${base}chuong-51/`);
  });

  it("cap số trang ở MAX_TOC_PAGES = 1000 dù #total-page lớn hơn", async () => {
    const first = `<html><body><input id="total-page" value="5000"><div id="list-chapter"><ul class="list-chapter"><li><a href="/t/chuong-1/">1</a></li></ul></div></body></html>`;
    const laterPage = `<html><body><div id="list-chapter"><ul class="list-chapter"><li><a href="./">x</a></li></ul></div></body></html>`;
    mockedFetchText.mockImplementation(async (url: string) => (url === "https://truyenfull.live/t/" ? first : laterPage));

    const toc = await fetchToc("https://truyenfull.live/t/");

    expect(mockedFetchText).toHaveBeenCalledTimes(1000);
    expect(mockedFetchText.mock.calls[999][0]).toBe("https://truyenfull.live/t/trang-1000/");
    expect(toc.chapters).toHaveLength(1000);
    expect(toc.chapters[999].url).toBe("https://truyenfull.live/t/trang-1000/");
  });

  it("ném lỗi rõ ràng khi trang không có danh sách chương", async () => {
    mockedFetchText.mockResolvedValue('<html><body><input id="total-page" value="1"><h1>Truyện</h1></body></html>');

    await expect(fetchToc("https://truyenfull.live/khong-co-chuong/")).rejects.toThrow(/No chapter list found/);
    expect(mockedFetchText).toHaveBeenCalledTimes(1);
  });
});

describe("normalizeStoryUrl", () => {
  it("cắt URL chương truyenfull về URL truyện", () => {
    expect(normalizeStoryUrl("https://truyenfull.live/dau-xuan-tuoi-sang/chuong-12/")).toBe(
      "https://truyenfull.live/dau-xuan-tuoi-sang/"
    );
  });

  it("cắt URL chương .html của truyencom về URL truyện", () => {
    expect(normalizeStoryUrl("https://truyencom.com/de-ba/chuong-118.html")).toBe("https://truyencom.com/de-ba/");
  });

  it("giữ nguyên URL truyện, bỏ query/hash", () => {
    expect(normalizeStoryUrl("https://truyenfull.live/dau-xuan-tuoi-sang/?abc=1#x")).toBe(
      "https://truyenfull.live/dau-xuan-tuoi-sang/"
    );
  });
});
