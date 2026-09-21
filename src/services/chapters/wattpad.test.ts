import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LockedContentError } from "../extractor";
import { fetchText } from "../toc/http";
import { fetchWattpadChapter, parseWattpadChapter } from "./wattpad";

vi.mock("../toc/http", () => ({ fetchText: vi.fn() }));

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

const CHAPTER_URL = "https://www.wattpad.com/148415654-pumpkin-patch-princess-chapter-two-visiting";

describe("parseWattpadChapter", () => {
  it("lấy tiêu đề từ h1 và map các đoạn văn trong <pre>, bỏ qua div quảng cáo/audio", () => {
    const chapter = parseWattpadChapter(readFixture("wattpad-chapter.html"), CHAPTER_URL);

    expect(chapter.sourceUrl).toBe(CHAPTER_URL);
    expect(chapter.title).toBe("CHAPTER TWO: Visiting Valentine");
    expect(chapter.blocks).toHaveLength(12);
    expect(chapter.blocks.every((b) => b.type === "paragraph")).toBe(true);
    expect(chapter.blocks[0].text).toBe(
      "I stopped to say hello to Miss Jenkins, who had worked at the library for as long as I could remember."
    );
    expect(chapter.blocks.some((b) => (b.text || "").includes("Advertisement"))).toBe(false);
  });

  it("lấy ảnh chèn giữa truyện thành block image", () => {
    const html =
      '<html><body><h1>Chương ảnh</h1><pre><p data-p-id="a">Mở đầu</p>' +
      '<p data-media-type="image" data-p-id="b"><img src="https://img.wattpad.com/abc?s=fit&amp;w=720" data-original-width="718"></p>' +
      "</pre></body></html>";
    const chapter = parseWattpadChapter(html, CHAPTER_URL);

    expect(chapter.blocks).toEqual([
      { type: "paragraph", text: "Mở đầu" },
      { type: "image", src: "https://img.wattpad.com/abc?s=fit&w=720", alt: "" },
    ]);
  });

  it("giữ alt của ảnh và bỏ qua <p> rỗng không có ảnh", () => {
    const html =
      '<html><body><h1>T</h1><pre>' +
      '<p data-p-id="a">   </p>' +
      '<p data-media-type="image" data-p-id="b"><img src="https://img.wattpad.com/x" alt="Bìa truyện"></p>' +
      '<p data-media-type="image" data-p-id="c"></p>' +
      '<p data-p-id="d"><img></p>' +
      '<p data-p-id="e">Nội dung</p>' +
      "</pre></body></html>";

    expect(parseWattpadChapter(html, CHAPTER_URL).blocks).toEqual([
      { type: "image", src: "https://img.wattpad.com/x", alt: "Bìa truyện" },
      { type: "paragraph", text: "Nội dung" },
    ]);
  });

  it("báo LockedContentError khi chương nằm sau paywall (Paid Stories)", () => {
    const url = "https://www.wattpad.com/643127331-of-cages-and-crowns-previously-the-culled-crown";
    const html = readFixture("wattpad-paid-chapter.html");

    let thrown: unknown = null;
    try {
      parseWattpadChapter(html, url);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(LockedContentError);
    expect(thrown instanceof Error ? thrown.message : "").toMatch(/Paid Stories/);
  });

  it("báo LockedContentError khi trang chỉ khớp nội dung Paid Stories (không có class paywall)", () => {
    const html =
      '<html><body><h1>Paid</h1><div class="cta">Buy this part or the entire story. Paid Stories program.</div></body></html>';

    expect(() => parseWattpadChapter(html, CHAPTER_URL)).toThrow(LockedContentError);
  });

  it("vẫn trả block khi trang nhắc Paid Stories nhưng có nội dung (chỉ chặn khi rỗng)", () => {
    const html =
      '<html><body><h1>Paid</h1><pre><p data-p-id="a">Free preview</p></pre>' +
      "<div>Buy this part. Paid Stories program.</div></body></html>";

    expect(parseWattpadChapter(html, CHAPTER_URL).blocks).toEqual([{ type: "paragraph", text: "Free preview" }]);
  });

  it("báo lỗi thường khi trang không có nội dung chương", () => {
    expect(() => parseWattpadChapter("<html><head><title>X</title></head><body>loading</body></html>", CHAPTER_URL)).toThrow(
      /Could not find chapter content/
    );
  });

  it("dùng <title> (bỏ hậu tố Wattpad) khi trang thiếu h1", () => {
    const html =
      '<html><head><title>Truyện A - Chương 5 - Wattpad</title></head><body><pre><p data-p-id="x">Nội dung</p></pre></body></html>';
    const chapter = parseWattpadChapter(html, CHAPTER_URL);
    expect(chapter.title).toBe("Truyện A - Chương 5");
    expect(chapter.blocks).toHaveLength(1);
  });

  it("dùng URL làm tiêu đề khi trang thiếu cả h1 lẫn title", () => {
    const html = '<html><body><pre><p data-p-id="a">Nội dung</p></pre></body></html>';

    expect(parseWattpadChapter(html, CHAPTER_URL).title).toBe(CHAPTER_URL);
  });
});

describe("fetchWattpadChapter", () => {
  const PART_URL = "https://www.wattpad.com/1537742464-ict-imagines-nkr";
  const PAGE_HTML =
    '<html><body><h1>NKR</h1><pre><p data-p-id="a">Trang một</p></pre></body></html>';

  beforeEach(() => {
    vi.mocked(fetchText).mockReset();
  });

  it("dùng storytext để lấy đủ các trang của part (HTML chỉ có trang đầu)", async () => {
    vi.mocked(fetchText).mockImplementation(async (url: string) =>
      url.includes("storytext")
        ? '<p data-p-id="a">Trang một</p><p data-p-id="b">Trang hai</p>' +
          '<p data-media-type="image" data-p-id="c"><img src="https://img.wattpad.com/xyz"></p>'
        : PAGE_HTML
    );

    const chapter = await fetchWattpadChapter(PART_URL);

    expect(chapter.title).toBe("NKR");
    expect(chapter.blocks).toEqual([
      { type: "paragraph", text: "Trang một" },
      { type: "paragraph", text: "Trang hai" },
      { type: "image", src: "https://img.wattpad.com/xyz", alt: "" },
    ]);
    expect(fetchText).toHaveBeenCalledWith("https://www.wattpad.com/apiv2/storytext?id=1537742464", {
      headers: { "User-Agent": expect.stringContaining("Mozilla/5.0") },
    });
  });

  it("giữ nội dung trang đầu khi storytext lỗi", async () => {
    vi.mocked(fetchText).mockImplementation(async (url: string) => {
      if (url.includes("storytext")) throw new Error("503");
      return PAGE_HTML;
    });

    const chapter = await fetchWattpadChapter(PART_URL);

    expect(chapter.blocks).toEqual([{ type: "paragraph", text: "Trang một" }]);
  });

  it("giữ block trang HTML khi storytext trả về không nhiều hơn", async () => {
    vi.mocked(fetchText).mockImplementation(async (url: string) =>
      url.includes("storytext") ? '<p data-p-id="b">Bản rút gọn</p>' : PAGE_HTML
    );

    const chapter = await fetchWattpadChapter(PART_URL);

    expect(chapter.blocks).toEqual([{ type: "paragraph", text: "Trang một" }]);
  });

  it("không gọi storytext khi URL không có part id dạng số", async () => {
    const url = "https://www.wattpad.com/story/999999-khong-co-part-id";
    vi.mocked(fetchText).mockResolvedValue(PAGE_HTML);

    const chapter = await fetchWattpadChapter(url);

    expect(chapter.blocks).toEqual([{ type: "paragraph", text: "Trang một" }]);
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText).toHaveBeenCalledWith(url, expect.anything());
  });

  it("lỗi tải trang HTML lan ra ngoài, không gọi storytext", async () => {
    vi.mocked(fetchText).mockRejectedValue(new Error("Failed to fetch (HTTP 403)"));

    await expect(fetchWattpadChapter(PART_URL)).rejects.toThrow("HTTP 403");
    expect(fetchText).toHaveBeenCalledTimes(1);
  });
});
