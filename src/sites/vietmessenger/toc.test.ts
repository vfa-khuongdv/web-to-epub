import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchText } from "../../services/toc/http";
import { fetchToc, normalizeVietmessengerStoryUrl, parseStoryPage } from "./toc";

vi.mock("../../services/toc/http", () => ({ fetchText: vi.fn() }));

const mockedFetchText = vi.mocked(fetchText);

const readFixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

const STORY_URL = "https://vietmessenger.com/books/?title=2030";

beforeEach(() => {
  mockedFetchText.mockReset();
});

describe("normalizeVietmessengerStoryUrl", () => {
  it("bỏ tham số page (URL chương) và www, giữ title", () => {
    expect(normalizeVietmessengerStoryUrl("https://www.vietmessenger.com/books/?title=2030&page=2")).toBe(
      "https://vietmessenger.com/books/?title=2030"
    );
  });

  it("giữ nguyên tên truyện có khoảng trắng (chuẩn hoá %20)", () => {
    expect(normalizeVietmessengerStoryUrl("https://vietmessenger.com/books/?title=trong%20voi%20que%20cu%20mien%20nam")).toBe(
      "https://vietmessenger.com/books/?title=trong+voi+que+cu+mien+nam"
    );
  });

  it("giữ nguyên URL không phải trang truyện (fetchToc sẽ báo lỗi rõ ràng)", () => {
    expect(normalizeVietmessengerStoryUrl("https://vietmessenger.com/comics/?title=abc")).toBe(
      "https://vietmessenger.com/comics/?title=abc"
    );
    expect(normalizeVietmessengerStoryUrl("https://vietmessenger.com/books/")).toBe(
      "https://vietmessenger.com/books/"
    );
  });
});

describe("parseStoryPage", () => {
  it("đọc title/author/cover/mục lục từ trang truyện thật", () => {
    const toc = parseStoryPage(readFixture("vietmessenger-story.html"), STORY_URL);

    expect(toc.title).toBe("2030");
    expect(toc.author).toBe("Trương Thanh Thùy");
    expect(toc.coverUrl).toBe("https://vietmessenger.com/books/covers/2030.jpg");
    expect(toc.chapters).toHaveLength(49);
    expect(toc.chapters[0]).toEqual({
      url: "https://vietmessenger.com/books/?title=2030",
      title: "Con hẻm tối ngoằn ngoèo",
    });
    expect(toc.chapters[1]).toEqual({
      url: "https://vietmessenger.com/books/?title=2030&page=2",
      title: "Rừng đen",
    });
    expect(toc.chapters[48]).toEqual({
      url: "https://vietmessenger.com/books/?title=2030&page=49",
      title: "Biển",
    });
  });

  it("chương đang mở (thẻ <b>) lấy URL từ trang hiện tại", () => {
    const html = `
      <div class="book-title"><b><a class="title" href="/books/?author=a">Tác Giả</a> » Truyện</b></div>
      <h1 class="t3">Truyện Thử</h1>
      <div id="ml"><h5>MỤC LỤC</h5><ul>
        <li><a href="?title=truyen-thu" class="txt">Chương 1</a></li>
        <li><b>Chương 2</b></li>
        <li><a href="?title=truyen-thu&page=3" class="txt">Chương 3</a></li>
      </ul></div>
      <div id="book-content"><div id="book-page" cat="truyendai" source="truyen-thu" page="2"></div></div>`;
    const toc = parseStoryPage(html, "https://vietmessenger.com/books/?title=truyen-thu&page=2");

    expect(toc.chapters).toEqual([
      { url: "https://vietmessenger.com/books/?title=truyen-thu", title: "Chương 1" },
      { url: "https://vietmessenger.com/books/?title=truyen-thu&page=2", title: "Chương 2" },
      { url: "https://vietmessenger.com/books/?title=truyen-thu&page=3", title: "Chương 3" },
    ]);
  });

  it("tiêu đề phần trỏ cùng trang với chương mở đầu phần (vd 'II. NƯỚC Ý' + '32. Tỉnh Giấc Mơ') → bỏ tiêu đề phần, giữ chương", () => {
    // Real markup from "Bá Tước Monte Cristo": the part heading and the chapter that
    // opens the part are two <li> entries with the same href; the page content itself
    // already carries the part name (as an <h2>), so the extra entry would duplicate it.
    const html = `
      <div class="book-title"><b><a class="title" href="/books/?author=a">Tác Giả</a> » Truyện</b></div>
      <h1 class="t3">Truyện Thử</h1>
      <div id="ml"><h5>MỤC LỤC</h5><ul>
        <li>I. MARSEILLES</li>
        <li><b>1. Tàu Cập Bến</b></li>
        <li><a href="?title=truyen-thu&amp;page=2" class="txt">II. NƯỚC Ý</a></li>
        <li><a href="?title=truyen-thu&amp;page=2" class="txt">2. Tỉnh Giấc Mơ</a></li>
        <li><a href="?title=truyen-thu&amp;page=3" class="txt">3. Chương Ba</a></li>
      </ul></div>
      <div id="book-content"><div id="book-page" cat="truyendich" source="truyen-thu" page="1"></div></div>`;
    const toc = parseStoryPage(html, "https://vietmessenger.com/books/?title=truyen-thu");

    expect(toc.chapters).toEqual([
      { url: "https://vietmessenger.com/books/?title=truyen-thu", title: "1. Tàu Cập Bến" },
      { url: "https://vietmessenger.com/books/?title=truyen-thu&page=2", title: "2. Tỉnh Giấc Mơ" },
      { url: "https://vietmessenger.com/books/?title=truyen-thu&page=3", title: "3. Chương Ba" },
    ]);
  });

  it("sách members-only (form đăng nhập, không có mục lục) báo lỗi rõ ràng", () => {
    const html = `<html><body><div id="main"><div id="member-login">SIGN IN</div></div></body></html>`;
    expect(() => parseStoryPage(html, "https://vietmessenger.com/books/?title=abc")).toThrow(
      /members-only on Viet Messenger/
    );
  });

  it("không có mục lục và không rõ nguyên nhân → báo không tìm thấy danh sách chương", () => {
    expect(() => parseStoryPage("<html><body></body></html>", "https://vietmessenger.com/books/?title=abc")).toThrow(
      /No chapter list found/
    );
  });
});

describe("fetchToc (vietmessenger.com)", () => {
  it("tải trang truyện rồi trả mục lục", async () => {
    mockedFetchText.mockResolvedValue(readFixture("vietmessenger-story.html"));

    const toc = await fetchToc(STORY_URL);

    expect(mockedFetchText).toHaveBeenCalledWith(
      STORY_URL,
      { headers: { "User-Agent": expect.stringContaining("Mozilla/5.0") } },
      { timeoutMs: 60_000 }
    );
    expect(toc.chapters).toHaveLength(49);
  });

  it("URL không có tham số title → báo không phải trang truyện", async () => {
    await expect(fetchToc("https://vietmessenger.com/books/")).rejects.toThrow(
      /not a Viet Messenger book page/
    );
    expect(mockedFetchText).not.toHaveBeenCalled();
  });

  it("URL ngoài mục /books/ (vd /comics/) → báo không phải trang truyện", async () => {
    await expect(fetchToc("https://vietmessenger.com/comics/?title=abc")).rejects.toThrow(
      /not a Viet Messenger book page/
    );
    expect(mockedFetchText).not.toHaveBeenCalled();
  });
});
