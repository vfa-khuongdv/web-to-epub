import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWattpadChapter } from "./chapters/wattpad";
import { extractWithRetry } from "./crawl";
import { LockedContentError } from "./extractor";
import { renderPageHtml } from "./renderer";

vi.mock("./chapters/wattpad", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chapters/wattpad")>();
  return { ...actual, fetchWattpadChapter: vi.fn() };
});

vi.mock("./extractor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./extractor")>();
  return { ...actual, extractChapter: vi.fn() };
});

vi.mock("./renderer", () => ({ renderPageHtml: vi.fn() }));

const WATTPAD_URL = "https://www.wattpad.com/148415654-pumpkin-patch-princess-chapter-two-visiting";
const OTHER_URL = "https://truyenfull.live/a/chuong-1/";

describe("extractWithRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dùng chapter fetcher của site khi có (Wattpad), không render trình duyệt", async () => {
    vi.mocked(fetchWattpadChapter).mockResolvedValue({
      sourceUrl: WATTPAD_URL,
      title: "CHAPTER TWO: Visiting Valentine",
      blocks: [{ type: "paragraph", text: "x" }],
    });

    const chapter = await extractWithRetry(WATTPAD_URL);

    expect(chapter.title).toBe("CHAPTER TWO: Visiting Valentine");
    expect(fetchWattpadChapter).toHaveBeenCalledWith(WATTPAD_URL);
    expect(renderPageHtml).not.toHaveBeenCalled();
  });

  it("dùng renderer + extractor chung cho site không có fetcher", async () => {
    vi.mocked(renderPageHtml).mockResolvedValue("<html>rendered</html>");
    const { extractChapter } = await import("./extractor");
    vi.mocked(extractChapter).mockReturnValue({ sourceUrl: OTHER_URL, title: "Chương 1", blocks: [] });

    await extractWithRetry(OTHER_URL);

    expect(renderPageHtml).toHaveBeenCalledWith(OTHER_URL);
    expect(extractChapter).toHaveBeenCalledWith(OTHER_URL, "<html>rendered</html>");
  });

  it("thử lại khi fetcher lỗi tạm thời", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchWattpadChapter)
        .mockRejectedValueOnce(new Error("tạm thời"))
        .mockResolvedValueOnce({ sourceUrl: WATTPAD_URL, title: "Chương", blocks: [] });

      const promise = extractWithRetry(WATTPAD_URL);
      await vi.advanceTimersByTimeAsync(1000);
      const chapter = await promise;

      expect(chapter.error).toBeUndefined();
      expect(fetchWattpadChapter).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("locked content dừng ngay, không thử lại", async () => {
    vi.mocked(fetchWattpadChapter).mockRejectedValue(new LockedContentError("Chương này thuộc chương trình trả phí"));

    const chapter = await extractWithRetry(WATTPAD_URL);

    expect(chapter.error).toMatch(/trả phí/);
    expect(fetchWattpadChapter).toHaveBeenCalledTimes(1);
  });
});
