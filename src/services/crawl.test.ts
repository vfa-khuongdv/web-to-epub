import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWattpadChapter } from "./chapters/wattpad";
import { estimateRemainingMs, extractWithRetry, MAX_ATTEMPTS } from "./crawl";
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
// xtruyen builds content with JS so no dedicated fetcher — this site uses shared renderer + extractor path.
const OTHER_URL = "https://xtruyen.vn/truyen/a/chuong-1/";

describe("extractWithRetry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses site's chapter fetcher when available (Wattpad), does not render browser", async () => {
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

  it("uses shared renderer + extractor for site without dedicated fetcher", async () => {
    vi.mocked(renderPageHtml).mockResolvedValue("<html>rendered</html>");
    const { extractChapter } = await import("./extractor");
    vi.mocked(extractChapter).mockReturnValue({ sourceUrl: OTHER_URL, title: "Chương 1", blocks: [] });

    await extractWithRetry(OTHER_URL);

    expect(renderPageHtml).toHaveBeenCalledWith(OTHER_URL);
    expect(extractChapter).toHaveBeenCalledWith(OTHER_URL, "<html>rendered</html>");
  });

  it("retries when fetcher has temporary error", async () => {
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

  it("if page is blanked, retries nearly immediately, does not wait for backoff", async () => {
    vi.useFakeTimers();
    try {
      const { extractChapter } = await import("./extractor");
      vi.mocked(renderPageHtml)
        .mockRejectedValueOnce(new BlankedPageError("Page blanked"))
        .mockResolvedValueOnce("<html>rendered</html>");
      vi.mocked(extractChapter).mockReturnValue({ sourceUrl: OTHER_URL, title: "Chương 1", blocks: [] });

      const promise = extractWithRetry(OTHER_URL);
      // Old backoff (1000ms) would prevent the second attempt from running this early.
      await vi.advanceTimersByTimeAsync(299);
      expect(renderPageHtml).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      const chapter = await promise;

      expect(chapter.error).toBeUndefined();
      expect(renderPageHtml).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("locked content stops immediately, does not retry", async () => {
    vi.mocked(fetchWattpadChapter).mockRejectedValue(new LockedContentError("This chapter is part of paid program"));

    const chapter = await extractWithRetry(WATTPAD_URL);

    expect(chapter.error).toMatch(/paid program/);
    expect(chapter.errorKind).toBe("locked");
    expect(fetchWattpadChapter).toHaveBeenCalledTimes(1);
  });

  it("locked content from the extractor stops the renderer branch immediately", async () => {
    const { extractChapter } = await import("./extractor");
    vi.mocked(renderPageHtml).mockResolvedValue("<html>rendered</html>");
    vi.mocked(extractChapter).mockImplementation(() => {
      throw new LockedContentError("Chương này thuộc chương trả phí");
    });

    const chapter = await extractWithRetry(OTHER_URL);

    expect(renderPageHtml).toHaveBeenCalledTimes(1);
    expect(extractChapter).toHaveBeenCalledTimes(1);
    expect(chapter.error).toBe("Chương này thuộc chương trả phí");
    expect(chapter.errorKind).toBe("locked");
  });

  it("exceeds MAX_ATTEMPTS returns chapter with error, does not throw", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchWattpadChapter).mockRejectedValue(new Error(" lỗi mạng "));

      const attempts: number[] = [];
      const promise = extractWithRetry(WATTPAD_URL, (n) => attempts.push(n));
      await vi.advanceTimersByTimeAsync(60_000);
      const chapter = await promise;

      expect(chapter.sourceUrl).toBe(WATTPAD_URL);
      expect(chapter.title).toBe(WATTPAD_URL);
      expect(chapter.error).toBe(" lỗi mạng ");
      expect(chapter.errorKind).toBe("other");
      expect(chapter.blocks).toEqual([]);
      expect(fetchWattpadChapter).toHaveBeenCalledTimes(MAX_ATTEMPTS);
      expect(attempts).toEqual(Array.from({ length: MAX_ATTEMPTS }, (_, i) => i + 1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps backoff at 3s: 9s of waiting reaches the 5th attempt", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchWattpadChapter).mockRejectedValue(new Error("lỗi mạng"));

      const promise = extractWithRetry(WATTPAD_URL);
      // Delays 1s, 2s, 3s, 3s (4s capped) → attempt 5 starts at 9s.
      // Without the cap attempt 5 would only start at 10s.
      await vi.advanceTimersByTimeAsync(8999);
      expect(fetchWattpadChapter).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchWattpadChapter).toHaveBeenCalledTimes(5);

      await vi.advanceTimersByTimeAsync(60_000);
      const chapter = await promise;
      expect(chapter.error).toBe("lỗi mạng");
    } finally {
      vi.useRealTimers();
    }
  });

  it("non-Error rejection falls back to 'Unknown error'", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchWattpadChapter).mockRejectedValue("boom");

      const promise = extractWithRetry(WATTPAD_URL);
      await vi.advanceTimersByTimeAsync(60_000);
      const chapter = await promise;

      expect(chapter.error).toBe("Unknown error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("succeeds on the final allowed attempt", async () => {
    vi.useFakeTimers();
    try {
      for (let i = 1; i < MAX_ATTEMPTS; i++) {
        vi.mocked(fetchWattpadChapter).mockRejectedValueOnce(new Error(`lỗi ${i}`));
      }
      vi.mocked(fetchWattpadChapter).mockResolvedValueOnce({
        sourceUrl: WATTPAD_URL,
        title: "Chương cuối",
        blocks: [{ type: "paragraph", text: "ok" }],
      });

      const promise = extractWithRetry(WATTPAD_URL);
      // Attempt MAX_ATTEMPTS starts at 30s (1s + 2s + 3s×9); at 29 999ms it hasn't run yet.
      await vi.advanceTimersByTimeAsync(29_999);
      expect(fetchWattpadChapter).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
      await vi.advanceTimersByTimeAsync(1);
      const chapter = await promise;

      expect(fetchWattpadChapter).toHaveBeenCalledTimes(MAX_ATTEMPTS);
      expect(chapter.error).toBeUndefined();
      expect(chapter.title).toBe("Chương cuối");
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls onAttempt with attempt number starting from 1", async () => {
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

  it("renderer temporary error → retries then succeeds", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(renderPageHtml)
        .mockRejectedValueOnce(new Error("Page blanked"))
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

  it("renderer continuous error → returns chapter with error after retries exhausted", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(renderPageHtml).mockRejectedValue(new Error("Page downloaded empty"));

      const promise = extractWithRetry(OTHER_URL);
      await vi.advanceTimersByTimeAsync(60_000);
      const chapter = await promise;

      expect(chapter.sourceUrl).toBe(OTHER_URL);
      expect(chapter.error).toMatch(/downloaded empty/);
      expect(chapter.blocks).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("onAttempt is called correct times for renderer fallback", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(renderPageHtml).mockRejectedValue(new Error("fail"));
      const attempts: number[] = [];
      const promise = extractWithRetry(OTHER_URL, (n) => attempts.push(n));
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;

      expect(attempts).toEqual(Array.from({ length: MAX_ATTEMPTS }, (_, i) => i + 1));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("estimateRemainingMs", () => {
  const base = { startedAt: 0, total: 10 };

  it("returns undefined when not enough samples (under 3 chapters)", () => {
    expect(estimateRemainingMs({ ...base, completed: 0, now: 10_000 })).toBeUndefined();
    expect(estimateRemainingMs({ ...base, completed: 2, now: 10_000 })).toBeUndefined();
  });

  it("returns undefined when already done", () => {
    expect(estimateRemainingMs({ ...base, completed: 10, now: 100_000 })).toBeUndefined();
    expect(estimateRemainingMs({ ...base, completed: 11, now: 100_000 })).toBeUndefined();
  });

  it("returns undefined when no time has elapsed", () => {
    expect(estimateRemainingMs({ ...base, completed: 3, now: 0 })).toBeUndefined();
  });

  it("returns undefined when the clock moved backwards", () => {
    expect(estimateRemainingMs({ ...base, completed: 3, now: -1 })).toBeUndefined();
    expect(estimateRemainingMs({ ...base, startedAt: 10_000, completed: 3, now: 9_999 })).toBeUndefined();
  });

  it("returns undefined when there is nothing to complete", () => {
    expect(estimateRemainingMs({ startedAt: 0, completed: 0, total: 0, now: 10_000 })).toBeUndefined();
  });

  it("uses Date.now() when now is omitted", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(30_000);
      // Same as completed: 3, now: 30_000 above.
      expect(estimateRemainingMs({ ...base, completed: 3 })).toBe(70_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("estimates by average speed of completed chapters", () => {
    // 3 chapters in 30 seconds → 10 seconds/chapter, 7 chapters left → 70 seconds.
    expect(estimateRemainingMs({ ...base, completed: 3, now: 30_000 })).toBe(70_000);
  });

  it("estimates when exactly one chapter is left", () => {
    // 9 chapters in 30 seconds → 10/3 seconds/chapter, 1 left → 3333ms.
    expect(estimateRemainingMs({ ...base, completed: 9, now: 30_000 })).toBe(3333);
  });

  it("rounds milliseconds", () => {
    // 3 chapters in 20 seconds → ~6.67 seconds/chapter, 7 left → ~46.67 seconds.
    expect(estimateRemainingMs({ ...base, completed: 3, now: 20_000 })).toBe(46_667);
  });
});
