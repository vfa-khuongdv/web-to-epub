import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchText, sleep } from "./http";
import { buildChapterUrl, decodeChapterTitle, fetchToc, parseChaptersResponse, parseMangaId, parseStoryMeta } from "./xtruyen";
import { normalizeStoryUrl } from "./normalizeUrl";

vi.mock("./http", () => ({ fetchText: vi.fn(), sleep: vi.fn() }));

const mockedFetchText = vi.mocked(fetchText);
const mockedSleep = vi.mocked(sleep);

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");
const nfc = (s: string) => s.normalize("NFC");

const chaptersJson = (from: number, count: number) =>
  JSON.stringify(Array.from({ length: count }, (_, i) => ({ s: `chuong-${from + i}`, n: `Chương ${from + i}` })));

beforeEach(() => {
  mockedFetchText.mockReset();
  mockedSleep.mockReset().mockResolvedValue(undefined);
});

describe("parseMangaId", () => {
  it("đọc data-id từ #manga-chapters-holder", () => {
    expect(parseMangaId(readFixture("xtruyen-story.html"))).toBe("2892796");
  });

  it("trả undefined khi thiếu holder hoặc data-id rỗng", () => {
    expect(parseMangaId('<div id="manga-chapters-holder"></div>')).toBeUndefined();
    expect(parseMangaId("<html><body></body></html>")).toBeUndefined();
  });
});

describe("parseStoryMeta", () => {
  it("title/author/cover best-effort", () => {
    const meta = parseStoryMeta(readFixture("xtruyen-story.html"), "https://xtruyen.vn/truyen/han-phu/");
    expect(nfc(meta.title)).toBe("HÃN PHU");
    expect(meta.author).toBe("Neleta");
    expect(meta.coverUrl?.startsWith("https://img.xtruyen.vn")).toBe(true);
  });

  it("fallback title: h1 -> <title> -> Untitled, thiếu cover/author thì undefined", () => {
    const byTitle = parseStoryMeta(
      "<html><head><title>Tên Truyện - Site</title></head><body></body></html>",
      "https://xtruyen.vn/a/"
    );
    expect(byTitle.title).toBe("Tên Truyện");
    expect(byTitle.author).toBeUndefined();
    expect(byTitle.coverUrl).toBeUndefined();

    const empty = parseStoryMeta("<html><body></body></html>", "https://xtruyen.vn/a/");
    expect(empty.title).toBe("Untitled");
  });

  it("cover tương đối ghép pageUrl, cover hỏng trả undefined", () => {
    const relative = parseStoryMeta(
      '<html><body><div class="summary_image"><img src="/c/x.jpg"></div></body></html>',
      "https://xtruyen.vn/a/"
    );
    expect(relative.coverUrl).toBe("https://xtruyen.vn/c/x.jpg");

    const broken = parseStoryMeta(
      '<html><body><div class="summary_image"><img src="http://["></div></body></html>',
      "https://xtruyen.vn/a/"
    );
    expect(broken.coverUrl).toBeUndefined();
  });
});

describe("parseChaptersResponse", () => {
  it("parse 100 item từ JSON API", () => {
    const items = parseChaptersResponse(readFixture("xtruyen-chapters.json"));
    expect(items).toHaveLength(100);
    expect(items[0]).toEqual({ slug: "chuong-1", title: "Chương 1" });
    expect(items[99].slug).toBe("chuong-100");
  });

  it("ném lỗi khi JSON sai định dạng", () => {
    expect(() => parseChaptersResponse("<html>khong phai json</html>")).toThrow(/did not return JSON/);
  });

  it("ném lỗi khi JSON không phải mảng", () => {
    expect(() => parseChaptersResponse("{}")).toThrow(/wrong format/);
    expect(() => parseChaptersResponse("null")).toThrow(/wrong format/);
  });

  it("lọc item sai kiểu, mảng rỗng trả []", () => {
    const items = parseChaptersResponse(
      JSON.stringify([{ s: "a", n: "A" }, null, 42, { s: 1, n: "x" }, { s: "b" }, { n: "c" }, { s: "c", n: "C" }])
    );
    expect(items).toEqual([
      { slug: "a", title: "A" },
      { slug: "c", title: "C" },
    ]);
    expect(parseChaptersResponse("[]")).toEqual([]);
  });

  it("tên chương trong API được giải mã", () => {
    const list = parseChaptersResponse('[{"s":"quyen-1-chuong-1","n":"Quyển 1 Chương 0&nbsp;"}]');
    expect(list).toEqual([{ slug: "quyen-1-chuong-1", title: "Quyển 1 Chương 0" }]);
  });
});

describe("buildChapterUrl", () => {
  it("ghép URL chương từ slug", () => {
    expect(buildChapterUrl("https://xtruyen.vn/truyen/han-phu/", "chuong-12")).toBe(
      "https://xtruyen.vn/truyen/han-phu/chuong-12/"
    );
  });

  it("bỏ slash đầu của slug; slug là URL tuyệt đối ghi đè base (hành vi hiện tại)", () => {
    expect(buildChapterUrl("https://xtruyen.vn/truyen/han-phu/", "/chuong-12")).toBe(
      "https://xtruyen.vn/truyen/han-phu/chuong-12/"
    );
    expect(buildChapterUrl("https://xtruyen.vn/truyen/han-phu/", "https://khac.com/chuong-1")).toBe(
      "https://khac.com/chuong-1/"
    );
  });
});

describe("normalizeStoryUrl (xtruyen)", () => {
  it("cắt URL chương về URL truyện", () => {
    expect(normalizeStoryUrl("https://xtruyen.vn/truyen/han-phu/chuong-233/")).toBe("https://xtruyen.vn/truyen/han-phu/");
  });
});

describe("decodeChapterTitle", () => {
  it("giải mã entity và bỏ khoảng trắng thừa", () => {
    expect(decodeChapterTitle("Quyển 1 Chương 0&nbsp;")).toBe("Quyển 1 Chương 0");
    expect(decodeChapterTitle("Chương 5: Trời &amp; Đất")).toBe("Chương 5: Trời & Đất");
    expect(decodeChapterTitle("Chương&#32;7&#x20;cuối")).toBe("Chương 7 cuối");
  });

  it("để nguyên chuỗi không phải entity hợp lệ", () => {
    expect(decodeChapterTitle("Chương 1 &khongcothat; &#999999999;")).toBe("Chương 1 &khongcothat; &#999999999;");
  });

  it("giữ nguyên entity số 0 và entity hỏng", () => {
    expect(decodeChapterTitle("A&#0;B")).toBe("A&#0;B");
    expect(decodeChapterTitle("A&#x0;B")).toBe("A&#x0;B");
    expect(decodeChapterTitle("Chương &#xZZ; 1")).toBe("Chương &#xZZ; 1");
  });

  it("giải mã entity astral và tên entity không phân biệt hoa thường", () => {
    expect(decodeChapterTitle("Chương &#x1F600;")).toBe("Chương 😀");
    expect(decodeChapterTitle("a&NBSP;b")).toBe("a b");
  });

  it("chuỗi chỉ có khoảng trắng trả rỗng", () => {
    expect(decodeChapterTitle("   ")).toBe("");
  });
});

describe("fetchToc (xtruyen)", () => {
  it("gửi POST 2 window, sleep 400ms giữa 2 window, dừng khi < 200 item", async () => {
    mockedFetchText
      .mockResolvedValueOnce(readFixture("xtruyen-story.html"))
      .mockResolvedValueOnce(chaptersJson(1, 200))
      .mockResolvedValueOnce(chaptersJson(201, 199));

    const toc = await fetchToc("https://xtruyen.vn/truyen/han-phu/");

    expect(mockedFetchText).toHaveBeenCalledTimes(3);
    expect(mockedSleep).toHaveBeenCalledTimes(1);
    expect(mockedSleep).toHaveBeenCalledWith(400);

    const [storyUrl, storyInit] = mockedFetchText.mock.calls[0];
    expect(storyUrl).toBe("https://xtruyen.vn/truyen/han-phu/");
    expect(storyInit).toEqual({
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      },
    });

    const [apiUrl, apiInit] = mockedFetchText.mock.calls[1];
    expect(apiUrl).toBe("https://xtruyen.vn/api/api-chapters.php");
    expect(apiInit).toEqual({
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        "x-custom-auth": "abC0000011111",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://xtruyen.vn/truyen/han-phu/",
      },
      body: "manga_id=2892796&from=1&to=200&vol=",
    });
    expect(mockedFetchText.mock.calls[2][1]?.body).toBe("manga_id=2892796&from=201&to=400&vol=");

    expect(nfc(toc.title)).toBe("HÃN PHU");
    expect(toc.author).toBe("Neleta");
    expect(toc.chapters).toHaveLength(399);
    expect(toc.chapters[0].url).toBe("https://xtruyen.vn/truyen/han-phu/chuong-1/");
    expect(toc.chapters[398].url).toBe("https://xtruyen.vn/truyen/han-phu/chuong-399/");
  });

  it("bỏ chapter trùng giữa các window", async () => {
    const window2 = JSON.stringify([
      { s: "chuong-1", n: "Chương 1" },
      ...Array.from({ length: 198 }, (_, i) => ({ s: `chuong-${201 + i}`, n: `Chương ${201 + i}` })),
    ]);
    mockedFetchText
      .mockResolvedValueOnce(readFixture("xtruyen-story.html"))
      .mockResolvedValueOnce(chaptersJson(1, 200))
      .mockResolvedValueOnce(window2);

    const toc = await fetchToc("https://xtruyen.vn/truyen/han-phu/");

    expect(toc.chapters).toHaveLength(398);
    expect(new Set(toc.chapters.map((c) => c.url)).size).toBe(398);
  });

  it("sắp xếp theo số chương, URL không có số xếp cuối", async () => {
    mockedFetchText
      .mockResolvedValueOnce(readFixture("xtruyen-story.html"))
      .mockResolvedValueOnce(
        JSON.stringify([
          { s: "chuong-10", n: "10" },
          { s: "phu-chuong", n: "Ngoại truyện" },
          { s: "chuong-2", n: "2" },
          { s: "chuong-1", n: "1" },
        ])
      );

    const toc = await fetchToc("https://xtruyen.vn/truyen/han-phu/");

    expect(toc.chapters.map((c) => c.url)).toEqual([
      "https://xtruyen.vn/truyen/han-phu/chuong-1/",
      "https://xtruyen.vn/truyen/han-phu/chuong-2/",
      "https://xtruyen.vn/truyen/han-phu/chuong-10/",
      "https://xtruyen.vn/truyen/han-phu/phu-chuong/",
    ]);
  });

  it("báo lỗi khi API trả danh sách rỗng", async () => {
    mockedFetchText.mockResolvedValueOnce(readFixture("xtruyen-story.html")).mockResolvedValueOnce("[]");

    await expect(fetchToc("https://xtruyen.vn/truyen/han-phu/")).rejects.toThrow(/No chapter list found/);
  });

  it("báo lỗi khi trang thiếu #manga-chapters-holder", async () => {
    mockedFetchText.mockResolvedValue("<html><body><h1>Truyện</h1></body></html>");

    await expect(fetchToc("https://xtruyen.vn/truyen/x/")).rejects.toThrow(/Story ID not found/);
    expect(mockedFetchText).toHaveBeenCalledTimes(1);
  });
});
