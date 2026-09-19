import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWattpadChapter } from "./chapters/wattpad";
import { estimateRemainingMs, extractWithRetry } from "./crawl";
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
    vi.clearAllMocks();
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
      // Advance only 300ms: old backoff (1000ms) would prevent second attempt from running.
      await vi.advanceTimersByTimeAsync(300);
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
    expect(fetchWattpadChapter).toHaveBeenCalledTimes(1);
  });

  it("exceeds MAX_ATTEMPTS returns chapter with error, does not throw", async () => {
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

      expect(attempts.length).toBeGreaterThan(1);
      expect(attempts[0]).toBe(1);
      expect(attempts[attempts.length - 1]).toBe(attempts.length);
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

  it("estimates by average speed of completed chapters", () => {
    // 3 chapters in 30 seconds → 10 seconds/chapter, 7 chapters left → 70 seconds.
    expect(estimateRemainingMs({ ...base, completed: 3, now: 30_000 })).toBe(70_000);
  });

  it("rounds milliseconds", () => {
    // 3 chapters in 20 seconds → ~6.67 seconds/chapter, 7 left → ~46.67 seconds.
    expect(estimateRemainingMs({ ...base, completed: 3, now: 20_000 })).toBe(46_667);
  });
});
