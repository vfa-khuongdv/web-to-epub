import { beforeEach, describe, expect, it, vi } from "vitest";
import { LockedContentError } from "../extractor";
import { renderPageHtml } from "../renderer";
import { fetchText } from "../toc/http";
import { fetchTruyenfullChapter } from "./truyenfull";

vi.mock("../toc/http", () => ({ fetchText: vi.fn() }));
vi.mock("../renderer", () => ({ renderPageHtml: vi.fn() }));

const CHAPTER_URL = "https://truyenfull.live/truyen-thu/chuong-1/";

// Truyenfull page is minimal: full text is in #chapter-c, hidden by CSS behind ad overlay.
function page(paragraphs: string[], hidden = true): string {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join("");
  return `<html><head><title>Truyện Thử - Chương 1 - TruyenFull</title></head><body>
    <h1>Truyện Thử</h1>
    <div class="ads-unlock-container">Click ads to unlock chapter</div>
    <div id="chapter-c"${hidden ? ' style="display:none"' : ""}>${body}</div>
  </body></html>`;
}

const LONG = Array.from(
  { length: 8 },
  (_, i) =>
    `Section ${i + 1} of test chapter, written long enough for the extractor to consider it main content ` +
    `not navigation snippet or sidebar ad.`
);

describe("fetchTruyenfullChapter", () => {
  beforeEach(() => {
    vi.mocked(fetchText).mockReset();
    vi.mocked(renderPageHtml).mockReset();
  });

  it("fetches content directly from pre-served HTML, does not open browser", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(LONG));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(chapter.sourceUrl).toBe(CHAPTER_URL);
    expect(chapter.blocks.length).toBeGreaterThanOrEqual(8);
    expect(chapter.blocks.every((b) => b.type === "paragraph")).toBe(true);
    expect(renderPageHtml).not.toHaveBeenCalled();
  });

  it("removes ad overlay so content does not mix with ad prompts", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(LONG));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(chapter.blocks.some((b) => (b.text || "").includes("mở khoá"))).toBe(false);
  });

  it("if pre-served HTML lacks enough text, falls back to browser rendering", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(["Đang tải..."]));
    vi.mocked(renderPageHtml).mockResolvedValue(page(LONG, false));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(renderPageHtml).toHaveBeenCalledWith(CHAPTER_URL);
    expect(chapter.blocks.length).toBeGreaterThanOrEqual(8);
  });

  it("if chapter is locked, reports immediately, does not waste extra render", async () => {
    vi.mocked(fetchText).mockResolvedValue(
      page([...LONG, "Nội dung chương đang bị khóa, vui lòng tắt quảng cáo rồi tải lại trang."])
    );

    await expect(fetchTruyenfullChapter(CHAPTER_URL)).rejects.toBeInstanceOf(LockedContentError);
    expect(renderPageHtml).not.toHaveBeenCalled();
  });
});
