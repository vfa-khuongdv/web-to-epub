import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchText, fetchWithRetry, sleep } from "../../services/toc/http";
import type { EpubMediaStore } from "../../services/epubMedia";
import { fetchMangadexChapter, isMangadexPageHost, pageSources } from "./chapter";

vi.mock("../../services/toc/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/toc/http")>()),
  fetchText: vi.fn(),
  fetchWithRetry: vi.fn(),
  sleep: vi.fn(async () => {}),
}));

const mockedApi = vi.mocked(fetchText);
const mockedFetch = vi.mocked(fetchWithRetry);
const mockedSleep = vi.mocked(sleep);

const readFixture = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8"));

const CHAPTER_ID = "837fdf72-0000-4000-8000-000000000000";
const CHAPTER_URL = `https://mangadex.org/chapter/${CHAPTER_ID}`;
const json = (body: unknown) => JSON.stringify(body);
// The start of a real JPEG / PNG file, so the page's type is read from its bytes; the tag tells pages apart.
const jpeg = (tag: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]);
const png = (tag: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]);
const chapterInfo = {
  result: "ok",
  data: { id: CHAPTER_ID, attributes: { volume: "1", chapter: "1", title: "Siêu tốc!", pages: 33, externalUrl: null } },
};

function fakeMedia() {
  const saved: { bytes: string; ext: string }[] = [];
  const media = {
    save: vi.fn((storyId: string, bytes: Buffer, ext: string) => {
      saved.push({ bytes: bytes.subarray(bytes[0] === 0xff ? 4 : 8).toString(), ext });
      return `epub-media/${storyId}/${saved.length}.${ext}`;
    }),
    find: vi.fn(),
    remove: vi.fn(),
  } as unknown as EpubMediaStore;
  return { media, saved };
}

beforeEach(() => {
  mockedApi.mockReset();
  mockedFetch.mockReset();
  mockedSleep.mockClear();
});

describe("isMangadexPageHost", () => {
  it("nhận node MangaDex@Home và máy chủ upload của MangaDex", () => {
    expect(isMangadexPageHost("https://cmdxd98sb0x3yprd.mangadex.network")).toBe(true);
    expect(isMangadexPageHost("https://cmdxd98sb0x3yprd.mangadex.network:44300")).toBe(true);
    expect(isMangadexPageHost("https://uploads.mangadex.org")).toBe(true);
  });

  it("từ chối host khác, http và địa chỉ hỏng", () => {
    expect(isMangadexPageHost("https://example.com")).toBe(false);
    expect(isMangadexPageHost("https://node.mangadex.network.example.com")).toBe(false);
    expect(isMangadexPageHost("https://evilmangadex.network")).toBe(false);
    expect(isMangadexPageHost("http://node.mangadex.network")).toBe(false);
    expect(isMangadexPageHost("not a url")).toBe(false);
  });
});

describe("pageSources", () => {
  it("ghép địa chỉ ảnh gốc và bản data-saver từ at-home (dữ liệu thật)", () => {
    const pages = pageSources(readFixture("mangadex-at-home.json"));
    expect(pages).toHaveLength(33);
    expect(pages[0].full).toBe(
      "https://cmdxd98sb0x3yprd.mangadex.network/data/afdbc201e029031de40a6ef299bd9948/1-b37c527e55c44b2041d2a425ea025e1ec6ebce5df9a879382e7d7cba7095f064.jpg"
    );
    expect(pages[0].saver).toMatch(/\/data-saver\/afdbc201e029031de40a6ef299bd9948\/1-7dfad6a7/);
  });

  it("trả mảng rỗng khi thiếu dữ liệu", () => {
    expect(pageSources({})).toEqual([]);
  });
});

describe("fetchMangadexChapter", () => {
  const atHome = {
    result: "ok",
    baseUrl: "https://node.mangadex.network",
    chapter: { hash: "h", data: ["1.jpg", "2.png"], dataSaver: ["1s.jpg", "2s.jpg"] },
  };

  function route(images: Record<string, Buffer>) {
    mockedApi.mockImplementation(async (url) => (String(url).includes("/at-home/server/") ? json(atHome) : json(chapterInfo)));
    mockedFetch.mockImplementation(async (url) =>
      images[String(url)] ? new Response(images[String(url)]) : new Response("", { status: 404 })
    );
  }

  it("tải và lưu mọi trang ngay khi crawl, theo đúng thứ tự", async () => {
    route({
      "https://node.mangadex.network/data/h/1.jpg": jpeg("one"),
      "https://node.mangadex.network/data/h/2.png": png("two"),
    });
    const { media, saved } = fakeMedia();
    const chapter = await fetchMangadexChapter(CHAPTER_URL, { storyId: "0123456789abcdef", media });
    expect(chapter.title).toBe("Vol. 1 Ch. 1 – Siêu tốc!");
    expect(saved).toHaveLength(2);
    expect(saved).toEqual(expect.arrayContaining([{ bytes: "one", ext: "jpg" }, { bytes: "two", ext: "png" }]));
    // Blocks keep page order even though pages download in parallel.
    const order = chapter.blocks.map((b) => saved[Number(b.src?.match(/\/(\d+)\./)?.[1]) - 1].bytes);
    expect(order).toEqual(["one", "two"]);
    expect(chapter.blocks.every((b) => b.type === "image" && b.src?.startsWith("epub-media/0123456789abcdef/"))).toBe(true);
  });

  it("thử bản data-saver khi ảnh gốc lỗi", async () => {
    route({
      "https://node.mangadex.network/data/h/1.jpg": jpeg("one"),
      "https://node.mangadex.network/data-saver/h/2s.jpg": jpeg("two-small"),
    });
    const { media, saved } = fakeMedia();
    await fetchMangadexChapter(CHAPTER_URL, { storyId: "0123456789abcdef", media });
    expect(saved).toContainEqual({ bytes: "two-small", ext: "jpg" });
  });

  it("báo lỗi (để thử lại) thay vì lưu chương thiếu trang", async () => {
    route({ "https://node.mangadex.network/data/h/1.jpg": jpeg("one") });
    const { media } = fakeMedia();
    await expect(fetchMangadexChapter(CHAPTER_URL, { storyId: "0123456789abcdef", media })).rejects.toThrow(/page 2/);
  });

  it("coi trang trả về không phải ảnh là lỗi", async () => {
    route({
      "https://node.mangadex.network/data/h/1.jpg": jpeg("one"),
      "https://node.mangadex.network/data/h/2.png": Buffer.from("<html>error</html>"),
      "https://node.mangadex.network/data-saver/h/2s.jpg": Buffer.from("<html>error</html>"),
    });
    const { media } = fakeMedia();
    await expect(fetchMangadexChapter(CHAPTER_URL, { storyId: "0123456789abcdef", media })).rejects.toThrow(/page 2/);
  });

  it("từ chối chương đăng ở trang khác", async () => {
    mockedApi.mockResolvedValueOnce(
      json({ ...chapterInfo, data: { ...chapterInfo.data, attributes: { ...chapterInfo.data.attributes, externalUrl: "https://mangaplus.shueisha.co.jp/viewer/1" } } })
    );
    const { media } = fakeMedia();
    await expect(fetchMangadexChapter(CHAPTER_URL, { storyId: "0123456789abcdef", media })).rejects.toThrow(/another site/);
  });

  it("không tải ảnh từ máy chủ lạ mà API đưa ra", async () => {
    mockedApi.mockImplementation(async (url) =>
      String(url).includes("/at-home/server/") ? json({ ...atHome, baseUrl: "https://example.com" }) : json(chapterInfo)
    );
    const { media } = fakeMedia();
    await expect(fetchMangadexChapter(CHAPTER_URL, { storyId: "0123456789abcdef", media })).rejects.toThrow(/unexpected server/);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("xếp hàng các lần gọi at-home của những chương crawl song song", async () => {
    route({
      "https://node.mangadex.network/data/h/1.jpg": jpeg("one"),
      "https://node.mangadex.network/data/h/2.png": png("two"),
    });
    const { media } = fakeMedia();
    const context = { storyId: "0123456789abcdef", media };
    const now = vi.spyOn(Date, "now");
    try {
      // A call at T, then two chapters start together 500 ms later: both have to wait.
      const t = Date.now() + 1_000_000;
      now.mockReturnValue(t);
      await fetchMangadexChapter(CHAPTER_URL, context);
      mockedSleep.mockClear();
      now.mockReturnValue(t + 500);
      await Promise.all([fetchMangadexChapter(CHAPTER_URL, context), fetchMangadexChapter(CHAPTER_URL, context)]);
      // The second takes the slot after the first instead of firing with it.
      expect(mockedSleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2500]);
    } finally {
      now.mockRestore();
    }
  });

  it("cần context để lưu ảnh", async () => {
    await expect(fetchMangadexChapter(CHAPTER_URL)).rejects.toThrow(/Could not store/);
    expect(mockedApi).not.toHaveBeenCalled();
  });
});
