import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchText } from "../../services/toc/http";
import {
  FeedChapter,
  fetchToc,
  normalizeMangadexStoryUrl,
  parseManga,
  parseMangadexId,
  pickChapters,
  pickLanguage,
  toTocChapters,
} from "./toc";

vi.mock("../../services/toc/http", () => ({ fetchText: vi.fn() }));

const mockedFetch = vi.mocked(fetchText);

const readFixture = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8"));

const MANGA_ID = "fb74e93d-e947-4774-83e7-d972b85d3d11";
const json = (body: unknown) => JSON.stringify(body);

beforeEach(() => {
  mockedFetch.mockReset();
});

describe("parseMangadexId", () => {
  it("lấy uuid từ URL truyện có hoặc không có slug", () => {
    expect(parseMangadexId(`https://mangadex.org/title/${MANGA_ID}/pok-mon-special-scarlet-violet`)).toBe(MANGA_ID);
    expect(parseMangadexId(`https://mangadex.org/title/${MANGA_ID}`)).toBe(MANGA_ID);
  });

  it("lấy uuid chương khi hỏi kind chapter, không nhầm sang trang truyện", () => {
    const url = "https://mangadex.org/chapter/2f780189-9159-432f-b077-57ad37aab395";
    expect(parseMangadexId(url, "chapter")).toBe("2f780189-9159-432f-b077-57ad37aab395");
    expect(parseMangadexId(url)).toBeUndefined();
  });

  it("trả undefined cho URL không hợp lệ", () => {
    expect(parseMangadexId("https://mangadex.org/title/abc")).toBeUndefined();
    expect(parseMangadexId("không phải url")).toBeUndefined();
  });
});

describe("normalizeMangadexStoryUrl", () => {
  it("bỏ ?lang=vi vì URL không có ngôn ngữ đã đọc tiếng Việt", () => {
    expect(normalizeMangadexStoryUrl(`https://mangadex.org/title/${MANGA_ID}?lang=vi`)).toBe(
      `https://mangadex.org/title/${MANGA_ID}`
    );
  });

  it("bỏ slug, giữ ?lang vì mỗi bản dịch là một truyện", () => {
    expect(normalizeMangadexStoryUrl(`https://mangadex.org/title/${MANGA_ID}/slug?lang=en&tab=art#x`)).toBe(
      `https://mangadex.org/title/${MANGA_ID}?lang=en`
    );
    expect(normalizeMangadexStoryUrl(`https://mangadex.org/title/${MANGA_ID}/slug`)).toBe(
      `https://mangadex.org/title/${MANGA_ID}`
    );
  });

  it("giữ nguyên URL không phải trang truyện", () => {
    const url = "https://mangadex.org/chapter/2f780189-9159-432f-b077-57ad37aab395";
    expect(normalizeMangadexStoryUrl(url)).toBe(url);
  });
});

describe("parseManga", () => {
  it("lấy tên, tác giả, ảnh bìa và các ngôn ngữ có bản dịch", () => {
    const manga = parseManga(readFixture("mangadex-manga.json").data);
    expect(manga.title).toBe("Pokémon SPECIAL Scarlet & Violet");
    expect(manga.author).toBe("Nintendo, Hidenori Kusaka");
    expect(manga.coverUrl).toBe(
      `https://uploads.mangadex.org/covers/${MANGA_ID}/dbdba374-759e-43f9-8669-8b623a3445fe.jpg`
    );
    expect(manga.languages).toEqual(["vi", "en"]);
  });
});

describe("pickLanguage", () => {
  it("dùng ngôn ngữ được hỏi nếu có, nếu không thì vi, en, rồi ngôn ngữ đầu tiên", () => {
    expect(pickLanguage("en", ["vi", "en"])).toBe("en");
    expect(pickLanguage("fr", ["en", "vi"])).toBe("vi");
    expect(pickLanguage(undefined, ["fr", "en"])).toBe("en");
    expect(pickLanguage(undefined, ["fr", "es"])).toBe("fr");
    expect(pickLanguage(undefined, [])).toBeUndefined();
  });
});

describe("pickChapters", () => {
  const chapter = (id: string, number: string | null, group: string, extra: Partial<FeedChapter["attributes"]> = {}): FeedChapter => ({
    id,
    attributes: { chapter: number, pages: 20, publishAt: "2024-01-01", ...extra },
    relationships: group ? [{ id: group, type: "scanlation_group" }] : [],
  });

  it("giữ một bản mỗi số chương, ưu tiên nhóm dịch nhiều chương nhất (feed thật)", () => {
    const chapters = toTocChapters(readFixture("mangadex-feed-en.json").data);
    // Ch. 1 và 2 có thêm bản không ghi nhóm; bản của nhóm chính được giữ.
    expect(chapters).toHaveLength(40);
    expect(chapters[0]).toEqual({
      url: "https://mangadex.org/chapter/7afd1a8a-b00e-4eb6-b4de-ec4e79e0d3ec",
      title: "Vol. 1 Ch. 1 – The Fastest Prince of Paldea!! (VS Miraidon)",
    });
    expect(chapters[6].title).toBe("Vol. 1 Ch. 6.5");
    expect(new Set(chapters.map((c) => c.url)).size).toBe(40);
  });

  it("bỏ chương đăng ở trang khác hoặc không có trang ảnh", () => {
    const picked = pickChapters([
      chapter("a", "1", "g", { externalUrl: "https://mangaplus.shueisha.co.jp/viewer/1" }),
      chapter("b", "2", "g", { pages: 0 }),
      chapter("c", "3", "g"),
    ]);
    expect(picked.map((c) => c.id)).toEqual(["c"]);
  });

  it("khi hòa thì giữ bản đăng sớm nhất; xếp theo số chương, chương không số để cuối", () => {
    const picked = pickChapters([
      chapter("extra", null, "g1"),
      chapter("10-late", "10", "g3", { publishAt: "2024-05-01" }),
      chapter("10-early", "10", "g4", { publishAt: "2024-04-01" }),
      chapter("2", "2", "g1"),
      chapter("2b", "2", "g2"),
    ]);
    expect(picked.map((c) => c.id)).toEqual(["2", "10-early", "extra"]);
  });
});

describe("fetchToc", () => {
  it("đọc truyện rồi feed theo ngôn ngữ trong URL", async () => {
    mockedFetch
      .mockResolvedValueOnce(json(readFixture("mangadex-manga.json")))
      .mockResolvedValueOnce(json(readFixture("mangadex-feed-en.json")));
    const toc = await fetchToc(`https://mangadex.org/title/${MANGA_ID}?lang=en`);
    expect(toc.title).toBe("Pokémon SPECIAL Scarlet & Violet");
    expect(toc.chapters).toHaveLength(40);
    const feedUrl = new URL(mockedFetch.mock.calls[1][0] as string);
    expect(feedUrl.pathname).toBe(`/manga/${MANGA_ID}/feed`);
    expect(feedUrl.searchParams.getAll("translatedLanguage[]")).toEqual(["en"]);
  });

  it("không có ?lang thì chọn tiếng Việt khi truyện có bản tiếng Việt", async () => {
    mockedFetch
      .mockResolvedValueOnce(json(readFixture("mangadex-manga.json")))
      .mockResolvedValueOnce(json({ result: "ok", data: [], total: 0 }));
    await expect(fetchToc(`https://mangadex.org/title/${MANGA_ID}`)).rejects.toThrow(/\(vi\)/);
    expect(new URL(mockedFetch.mock.calls[1][0] as string).searchParams.get("translatedLanguage[]")).toBe("vi");
  });

  it("đọc feed nhiều trang cho tới khi đủ total", async () => {
    const feed = readFixture("mangadex-feed-en.json").data as FeedChapter[];
    const pageOf = (from: number) =>
      Array.from({ length: 500 }, (_, i) => ({ ...feed[2], id: `p${from + i}`, attributes: { ...feed[2].attributes, chapter: String(from + i + 1) } }));
    mockedFetch
      .mockResolvedValueOnce(json(readFixture("mangadex-manga.json")))
      .mockResolvedValueOnce(json({ data: pageOf(0), total: 501 }))
      .mockResolvedValueOnce(json({ data: [{ ...feed[2], id: "last", attributes: { ...feed[2].attributes, chapter: "501" } }], total: 501 }));
    const toc = await fetchToc(`https://mangadex.org/title/${MANGA_ID}?lang=en`);
    expect(toc.chapters).toHaveLength(501);
    expect(new URL(mockedFetch.mock.calls[2][0] as string).searchParams.get("offset")).toBe("500");
  });

  it("báo lỗi khi API không trả về JSON", async () => {
    mockedFetch.mockResolvedValueOnce("<html>maintenance</html>");
    await expect(fetchToc(`https://mangadex.org/title/${MANGA_ID}`)).rejects.toThrow(/did not return JSON/);
  });

  it("báo lỗi khi URL không phải trang truyện", async () => {
    await expect(fetchToc("https://mangadex.org/titles")).rejects.toThrow(/not a MangaDex title page/);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
