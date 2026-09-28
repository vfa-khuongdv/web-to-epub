import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchText } from "../toc/http";
import { decodeChapterHtml, fetchVietmessengerChapter, parseChapterHtml } from "./vietmessenger";

vi.mock("../toc/http", () => ({ fetchText: vi.fn() }));

const mockedFetchText = vi.mocked(fetchText);

const readFixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

// Real response captured from /books/gethtml.php for 2030 page 2 ("Rừng đen"), still
// HTML-entity-encoded the way the site's jQuery puts it into the DOM before decrypting.
const PAYLOAD = readFixture("vietmessenger-gethtml-page2.json");

const storyPage = (cat: string | null, source: string | null) => `<!doctype html><html><body>
  <div class="book-title"><b><a class="title" href="/books/?author=a">Tác Giả</a> » Truyện</b></div>
  <h1 class="t3">Truyện Thử</h1>
  <div id="ml"><ul><li><b>Chương 1</b></li></ul></div>
  <div id="book-content"><div id="book-page"${cat ? ` cat="${cat}"` : ""}${source ? ` source="${source}"` : ""} page="1"></div></div>
</body></html>`;

const MEMBERS_ONLY = `<html><body><div id="main"><div id="member-login">SIGN IN</div></div></body></html>`;

beforeEach(() => {
  mockedFetchText.mockReset();
});

describe("decodeChapterHtml", () => {
  it("giải mã đúng payload thật của site (AES + HTML entities)", () => {
    const html = decodeChapterHtml(PAYLOAD, "https://vietmessenger.com/books/?title=2030&page=2");

    expect(html).toContain('<h3 align="center"><a name="1">Rừng đen</a></h3>');
    expect(html).toContain("Adam hít một hơi thật sâu");
  });

  it("payload không phải JSON (chương không còn) → báo lỗi rõ ràng", () => {
    expect(() => decodeChapterHtml("no file", "https://vietmessenger.com/books/?title=2030&page=99")).toThrow(
      /did not return chapter content/
    );
  });
});

describe("parseChapterHtml", () => {
  it("lấy tiêu đề từ heading có anchor, bỏ heading trùng tiêu đề khỏi nội dung", () => {
    const html = `<br /><!-- Trương Thanh Thùy - 2030 -->
      <h3 align="center"><a name="1">Rừng đen</a></h3>
      <p align="justify">Adam hít một hơi thật sâu.</p>
      <p align="justify">Đoạn thứ hai.</p>`;
    const chapter = parseChapterHtml(html, "https://vietmessenger.com/books/?title=2030&page=2");

    expect(chapter.title).toBe("Rừng đen");
    expect(chapter.blocks).toEqual([
      { type: "paragraph", text: "Adam hít một hơi thật sâu." },
      { type: "paragraph", text: "Đoạn thứ hai." },
    ]);
  });

  it("trang đầu có phần mở đầu: giữ heading khác, chỉ bỏ heading của chương", () => {
    const html = `<h3 align="center">Lời cảm ơn</h3>
      <p align="justify">Cảm ơn bạn đọc.</p>
      <h3 align="center"><a name="1">Con hẻm tối ngoằn ngoèo</a></h3>
      <p align="justify">Nội dung chương một.</p>`;
    const chapter = parseChapterHtml(html, "https://vietmessenger.com/books/?title=2030");

    expect(chapter.title).toBe("Con hẻm tối ngoằn ngoèo");
    expect(chapter.blocks).toEqual([
      { type: "heading", level: 3, text: "Lời cảm ơn" },
      { type: "paragraph", text: "Cảm ơn bạn đọc." },
      { type: "paragraph", text: "Nội dung chương một." },
    ]);
  });
});

describe("fetchVietmessengerChapter", () => {
  const chapterUrl = (slug: string, page = 1) =>
    `https://vietmessenger.com/books/?title=${slug}${page > 1 ? `&page=${page}` : ""}`;

  it("đọc cat từ trang truyện rồi POST gethtml, trả blocks", async () => {
    const url = chapterUrl("cache-a", 2);
    mockedFetchText.mockImplementation(async (input, init) =>
      init?.method === "POST" ? PAYLOAD : storyPage("truyendai", "cache-a")
    );

    const chapter = await fetchVietmessengerChapter(url);

    expect(chapter.sourceUrl).toBe(url);
    expect(chapter.blocks[0]).toEqual({
      type: "paragraph",
      text: expect.stringContaining("Adam hít một hơi thật sâu"),
    });
    expect(mockedFetchText).toHaveBeenNthCalledWith(
      1,
      chapterUrl("cache-a"),
      { headers: { "User-Agent": expect.stringContaining("Mozilla/5.0") } },
      { timeoutMs: 60_000 }
    );
    expect(mockedFetchText).toHaveBeenNthCalledWith(
      2,
      "https://vietmessenger.com/books/gethtml.php",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": expect.stringContaining("Mozilla/5.0"),
          "X-Requested-With": "XMLHttpRequest",
          Referer: url,
        },
        body: "c=truyendai&t=cache-a&p=2",
      },
      { timeoutMs: 60_000 }
    );
  });

  it("gửi tham số t là source của trang truyện, không phải title trong URL", async () => {
    // Real case: "Bá Tước Monte Cristo" has title "ba tuoc monte cristo" in the URL but
    // source "batuocmontecristo" (spaces stripped); gethtml.php only answers the source.
    const url = chapterUrl("ba-tuoc-monte-cristo", 2);
    mockedFetchText.mockImplementation(async (input, init) =>
      init?.method === "POST" ? PAYLOAD : storyPage("truyendich", "batuocmontecristo")
    );

    await fetchVietmessengerChapter(url);

    expect(mockedFetchText).toHaveBeenNthCalledWith(
      2,
      "https://vietmessenger.com/books/gethtml.php",
      expect.objectContaining({ body: "c=truyendich&t=batuocmontecristo&p=2" }),
      { timeoutMs: 60_000 }
    );
  });

  it("trang truyện thiếu source → dùng title trong URL làm tham số t", async () => {
    const url = chapterUrl("no-source-a", 2);
    mockedFetchText.mockImplementation(async (input, init) =>
      init?.method === "POST" ? PAYLOAD : storyPage("truyendai", null)
    );

    await fetchVietmessengerChapter(url);

    expect(mockedFetchText).toHaveBeenNthCalledWith(
      2,
      "https://vietmessenger.com/books/gethtml.php",
      expect.objectContaining({ body: "c=truyendai&t=no-source-a&p=2" }),
      { timeoutMs: 60_000 }
    );
  });

  it("cat được cache theo truyện: chương sau không tải lại trang truyện", async () => {
    mockedFetchText.mockImplementation(async (input, init) =>
      init?.method === "POST" ? PAYLOAD : storyPage("truyendai", "cache-b")
    );

    await fetchVietmessengerChapter(chapterUrl("cache-b", 1));
    await fetchVietmessengerChapter(chapterUrl("cache-b", 2));

    const storyPageCalls = mockedFetchText.mock.calls.filter(([, init]) => init?.method !== "POST");
    expect(storyPageCalls).toHaveLength(1);
    expect(mockedFetchText).toHaveBeenCalledTimes(3);
  });

  it("sách members-only → báo lỗi rõ ràng, không gọi gethtml", async () => {
    mockedFetchText.mockResolvedValue(MEMBERS_ONLY);

    await expect(fetchVietmessengerChapter(chapterUrl("locked-a"))).rejects.toThrow(
      /members-only on Viet Messenger/
    );
    expect(mockedFetchText).toHaveBeenCalledTimes(1);
  });

  it("trang truyện không có cat → báo lỗi rõ ràng", async () => {
    mockedFetchText.mockResolvedValue(storyPage(null, "nocat-a"));

    await expect(fetchVietmessengerChapter(chapterUrl("nocat-a"))).rejects.toThrow(
      /Could not find the book's category/
    );
  });

  it("URL không có tham số title → báo không phải trang chương", async () => {
    await expect(fetchVietmessengerChapter("https://vietmessenger.com/books/")).rejects.toThrow(
      /not a Viet Messenger chapter page/
    );
    expect(mockedFetchText).not.toHaveBeenCalled();
  });

  it("URL ngoài mục /books/ (vd /comics/) → báo không phải trang chương", async () => {
    await expect(
      fetchVietmessengerChapter("https://vietmessenger.com/comics/?title=abc&page=2")
    ).rejects.toThrow(/not a Viet Messenger chapter page/);
    expect(mockedFetchText).not.toHaveBeenCalled();
  });
});
