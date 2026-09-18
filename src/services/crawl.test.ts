import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWattpadChapter } from "./chapters/wattpad";
import { extractWithRetry } from "./crawl";
import { LockedContentError } from "./extractor";
import { BlankedPageError, renderPageHtml } from "./renderer";

vi.mock("./chapters/wattpad", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chapters/wattpad")>();
  return { ...actual, fetchWattpadChapter: vi.fn() };
});

vi.mock("./extractor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./extractor")>();
  return { ...actual, extractChapter: vi.fn() };
});

vi.mock("./renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./renderer")>();
  return { ...actual, renderPageHtml: vi.fn() };
});

const WATTPAD_URL = "https://www.wattpad.com/148415654-pumpkin-patch-princess-chapter-two-visiting";
// xtruyen dựng nội dung bằng JS nên không có fetcher riêng — đây là site đi
// đường renderer + extractor chung.
const OTHER_URL = "https://xtruyen.vn/truyen/a/chuong-1/";

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

  it("trang bị xoá trắng thì thử lại gần như ngay, không chờ backoff", async () => {
    vi.useFakeTimers();
    try {
      const { extractChapter } = await import("./extractor");
      vi.mocked(renderPageHtml)
        .mockRejectedValueOnce(new BlankedPageError("Trang bị xoá trắng"))
        .mockResolvedValueOnce("<html>rendered</html>");
      vi.mocked(extractChapter).mockReturnValue({ sourceUrl: OTHER_URL, title: "Chương 1", blocks: [] });

      const promise = extractWithRetry(OTHER_URL);
      // Chỉ nhích 300ms: backoff cũ (1000ms) sẽ khiến lượt thử thứ hai chưa chạy.
      await vi.advanceTimersByTimeAsync(300);
      const chapter = await promise;

      expect(chapter.error).toBeUndefined();
      expect(renderPageHtml).toHaveBeenCalledTimes(2);
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

  it("hết MAX_ATTEMPTS trả chapter có error, không throw", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchWattpadChapter).mockRejectedValue(new Error(" lỗi mạng "));

      const promise = extractWithRetry(WATTPAD_URL);
      await vi.advanceTimersByTimeAsync(60_000);
      const chapter = await promise;

      expect(chapter.sourceUrl).toBe(WATTPAD_URL);
      expect(chapter.error).toBe(" lỗi mạng ");
      expect(chapter.blocks).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gọi onAttempt với số thứ tự thử từ 1", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchWattpadChapter)
        .mockRejectedValueOnce(new Error("a"))
        .mockResolvedValueOnce({ sourceUrl: WATTPAD_URL, title: "OK", blocks: [] });

      const attempts: number[] = [];
      const promise = extractWithRetry(WATTPAD_URL, (n) => attempts.push(n));
      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(attempts).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renderer lỗi tạm thời → thử lại rồi thành công", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(renderPageHtml)
        .mockRejectedValueOnce(new Error("Trang bị xoá trắng"))
        .mockResolvedValueOnce("<html>rendered</html>");
      const { extractChapter } = await import("./extractor");
      vi.mocked(extractChapter).mockReturnValue({ sourceUrl: OTHER_URL, title: "Chương", blocks: [] });

      const promise = extractWithRetry(OTHER_URL);
      await vi.advanceTimersByTimeAsync(1000);
      const chapter = await promise;

      expect(chapter.error).toBeUndefined();
      expect(renderPageHtml).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renderer lỗi liên tục → trả chapter có error sau khi hết retries", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(renderPageHtml).mockRejectedValue(new Error("Trang tải về rỗng"));

      const promise = extractWithRetry(OTHER_URL);
      await vi.advanceTimersByTimeAsync(60_000);
      const chapter = await promise;

      expect(chapter.sourceUrl).toBe(OTHER_URL);
      expect(chapter.error).toMatch(/rỗng/);
      expect(chapter.blocks).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("onAttempt được gọi đúng số lần cho renderer fallback", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(renderPageHtml).mockRejectedValue(new Error("fail"));
      const attempts: number[] = [];
      const promise = extractWithRetry(OTHER_URL, (n) => attempts.push(n));
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;

      expect(attempts.length).toBeGreaterThan(1);
      expect(attempts[0]).toBe(1);
      expect(attempts[attempts.length - 1]).toBe(attempts.length);
    } finally {
      vi.useRealTimers();
    }
  });
});
