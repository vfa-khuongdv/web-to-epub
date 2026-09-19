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

  it("báo LockedContentError khi chương nằm sau paywall (Paid Stories)", () => {
    const url = "https://www.wattpad.com/643127331-of-cages-and-crowns-previously-the-culled-crown";
    expect(() => parseWattpadChapter(readFixture("wattpad-paid-chapter.html"), url)).toThrow(LockedContentError);
    expect(() => parseWattpadChapter(readFixture("wattpad-paid-chapter.html"), url)).toThrow(/Paid Stories/);
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
  });

  it("giữ nội dung trang đầu khi storytext lỗi", async () => {
    vi.mocked(fetchText).mockImplementation(async (url: string) => {
      if (url.includes("storytext")) throw new Error("503");
      return PAGE_HTML;
    });

    const chapter = await fetchWattpadChapter(PART_URL);

    expect(chapter.blocks).toEqual([{ type: "paragraph", text: "Trang một" }]);
  });
});
