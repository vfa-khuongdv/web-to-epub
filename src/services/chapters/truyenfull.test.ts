import { beforeEach, describe, expect, it, vi } from "vitest";
import { LockedContentError } from "../extractor";
import { renderPageHtml } from "../renderer";
import { fetchText } from "../toc/http";
import { fetchTruyenfullChapter } from "./truyenfull";

vi.mock("../toc/http", () => ({ fetchText: vi.fn() }));
vi.mock("../renderer", () => ({ renderPageHtml: vi.fn() }));

const CHAPTER_URL = "https://truyenfull.live/truyen-thu/chuong-1/";

// Trang truyenfull dựng lại ở dạng tối giản: toàn văn nằm sẵn trong #chapter-c,
// bị CSS giấu sau lớp phủ quảng cáo.
function page(paragraphs: string[], hidden = true): string {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join("");
  return `<html><head><title>Truyện Thử - Chương 1 - TruyenFull</title></head><body>
    <h1>Truyện Thử</h1>
    <div class="ads-unlock-container">Bấm vào quảng cáo để mở khoá chương</div>
    <div id="chapter-c"${hidden ? ' style="display:none"' : ""}>${body}</div>
  </body></html>`;
}

const LONG = Array.from(
  { length: 8 },
  (_, i) =>
    `Đoạn thứ ${i + 1} của chương thử nghiệm, viết dài vừa đủ để bộ trích xuất coi đây là phần nội dung chính ` +
    `của trang chứ không phải một mẩu điều hướng hay quảng cáo nằm bên lề.`
);

describe("fetchTruyenfullChapter", () => {
  beforeEach(() => {
    vi.mocked(fetchText).mockReset();
    vi.mocked(renderPageHtml).mockReset();
  });

  it("lấy nội dung thẳng từ HTML phục vụ sẵn, không mở trình duyệt", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(LONG));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(chapter.sourceUrl).toBe(CHAPTER_URL);
    expect(chapter.blocks.length).toBeGreaterThanOrEqual(8);
    expect(chapter.blocks.every((b) => b.type === "paragraph")).toBe(true);
    expect(renderPageHtml).not.toHaveBeenCalled();
  });

  it("gỡ lớp phủ quảng cáo nên nội dung không lẫn lời mời bấm quảng cáo", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(LONG));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(chapter.blocks.some((b) => (b.text || "").includes("mở khoá"))).toBe(false);
  });

  it("HTML phục vụ sẵn không đủ chữ thì quay về render bằng trình duyệt", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(["Đang tải..."]));
    vi.mocked(renderPageHtml).mockResolvedValue(page(LONG, false));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(renderPageHtml).toHaveBeenCalledWith(CHAPTER_URL);
    expect(chapter.blocks.length).toBeGreaterThanOrEqual(8);
  });

  it("chương bị khoá thì báo ngay, không tốn thêm một lượt render", async () => {
    vi.mocked(fetchText).mockResolvedValue(
      page([...LONG, "Nội dung chương đang bị khóa, vui lòng tắt quảng cáo rồi tải lại trang."])
    );

    await expect(fetchTruyenfullChapter(CHAPTER_URL)).rejects.toBeInstanceOf(LockedContentError);
    expect(renderPageHtml).not.toHaveBeenCalled();
  });
});
