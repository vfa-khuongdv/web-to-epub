import { beforeEach, describe, expect, it, vi } from "vitest";
import { LockedContentError } from "../extractor";
import { renderPageHtml } from "../renderer";
import { loadSiteSession, sessionRequestHeaders } from "../siteSession";
import { fetchText } from "../toc/http";
import { fetchTruyenfullChapter } from "./truyenfull";

vi.mock("../toc/http", () => ({ fetchText: vi.fn() }));
vi.mock("../renderer", () => ({ renderPageHtml: vi.fn() }));
vi.mock("../siteSession", () => ({ loadSiteSession: vi.fn(), sessionRequestHeaders: vi.fn() }));

const mockedLoadSession = vi.mocked(loadSiteSession);
const mockedSessionHeaders = vi.mocked(sessionRequestHeaders);

const CHAPTER_URL = "https://truyenfull.live/truyen-thu/chuong-1/";
const LOCKED_TEXT = "Nội dung chương đang bị khóa, vui lòng tắt quảng cáo rồi tải lại trang.";
const CHALLENGE_HTML =
  "<html><head><title>Chờ một chút...</title></head><body><p>Trang này xác minh bạn không phải là bot.</p></body></html>";

// Truyenfull page is minimal: full text is in #chapter-c, hidden by CSS behind ad overlay.
// The overlay sits inside #chapter-c and says "mở khoá", so extraction only passes by stripping it.
function pageHtml(inner: string, hidden = true): string {
  return `<html><head><title>Truyện Thử - Chương 1 - TruyenFull</title></head><body>
    <h1>Truyện Thử</h1>
    <div id="chapter-c"${hidden ? ' style="display:none"' : ""}>
      <div class="ads-unlock-container">Bạn cần mở khoá chương để đọc tiếp</div>
      ${inner}
    </div>
  </body></html>`;
}

function page(paragraphs: string[], hidden = true): string {
  return pageHtml(paragraphs.map((p) => `<p>${p}</p>`).join(""), hidden);
}

const LONG = Array.from(
  { length: 8 },
  (_, i) =>
    `Section ${i + 1} of test chapter, written long enough for the extractor to consider it main content ` +
    `not navigation snippet or sidebar ad.`
);

const paragraphBlocks = (texts: string[]) => texts.map((text) => ({ type: "paragraph", text }));

describe("fetchTruyenfullChapter", () => {
  beforeEach(() => {
    vi.mocked(fetchText).mockReset();
    vi.mocked(renderPageHtml).mockReset();
    mockedSessionHeaders.mockReset().mockReturnValue({});
    mockedLoadSession.mockReset().mockReturnValue(undefined);
  });

  it("fetches content directly from pre-served HTML, does not open browser", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(LONG));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(chapter.sourceUrl).toBe(CHAPTER_URL);
    expect(chapter.blocks).toEqual(paragraphBlocks(LONG));
    expect(renderPageHtml).not.toHaveBeenCalled();
    expect(fetchText).toHaveBeenCalledWith(CHAPTER_URL, {
      headers: { "User-Agent": expect.stringContaining("Mozilla/5.0") },
    });
  });

  it("removes ad overlay inside #chapter-c so content does not mix with ad prompts", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(LONG));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(chapter.blocks).toEqual(paragraphBlocks(LONG));
    expect(chapter.blocks.some((b) => (b.text || "").includes("mở khoá"))).toBe(false);
  });

  it("if pre-served HTML lacks enough text, falls back to browser rendering", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(["Đang tải..."]));
    vi.mocked(renderPageHtml).mockResolvedValue(page(LONG, false));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(renderPageHtml).toHaveBeenCalledWith(CHAPTER_URL);
    expect(chapter.blocks).toEqual(paragraphBlocks(LONG));
  });

  it("if pre-served extraction fails with an ordinary error, falls back to browser rendering", async () => {
    vi.mocked(fetchText).mockResolvedValue("<html><body></body></html>");
    vi.mocked(renderPageHtml).mockResolvedValue(page(LONG, false));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(renderPageHtml).toHaveBeenCalledWith(CHAPTER_URL);
    expect(chapter.blocks).toEqual(paragraphBlocks(LONG));
  });

  it("uses served HTML at exactly MIN_SERVED_TEXT (500 chars), no render", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(["x".repeat(500)]));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(renderPageHtml).not.toHaveBeenCalled();
    expect(chapter.blocks).toEqual(paragraphBlocks(["x".repeat(500)]));
  });

  it("renders when served text is below MIN_SERVED_TEXT (499 chars)", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(["x".repeat(499)]));
    vi.mocked(renderPageHtml).mockResolvedValue(page(["y".repeat(600)], false));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(renderPageHtml).toHaveBeenCalledWith(CHAPTER_URL);
    expect(chapter.blocks).toEqual(paragraphBlocks(["y".repeat(600)]));
  });

  it("uses served HTML above MIN_SERVED_TEXT (501 chars), no render", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(["x".repeat(501)]));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(renderPageHtml).not.toHaveBeenCalled();
    expect(chapter.blocks).toEqual(paragraphBlocks(["x".repeat(501)]));
  });

  it("does not count image blocks towards textLength (499 chars + image still renders)", async () => {
    vi.mocked(fetchText).mockResolvedValue(
      pageHtml(`<p>${"x".repeat(499)}</p><figure><img src="/cover.png" alt="Bìa"></figure>`)
    );
    vi.mocked(renderPageHtml).mockResolvedValue(page(LONG, false));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(renderPageHtml).toHaveBeenCalledWith(CHAPTER_URL);
    expect(chapter.blocks).toEqual(paragraphBlocks(LONG));
  });

  it("keeps image blocks when there is enough text", async () => {
    vi.mocked(fetchText).mockResolvedValue(
      pageHtml(`<p>${"x".repeat(500)}</p><figure><img src="/cover.png" alt="Bìa"></figure>`)
    );

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(renderPageHtml).not.toHaveBeenCalled();
    expect(chapter.blocks).toEqual([
      { type: "paragraph", text: "x".repeat(500) },
      { type: "image", src: "https://truyenfull.live/cover.png", alt: "Bìa" },
    ]);
  });

  it("if fetching the served HTML is blocked, falls back to browser rendering", async () => {
    vi.mocked(fetchText).mockRejectedValue(new Error("Failed to fetch (HTTP 403)"));
    vi.mocked(renderPageHtml).mockResolvedValue(page(LONG, false));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(renderPageHtml).toHaveBeenCalledWith(CHAPTER_URL);
    expect(chapter.blocks).toEqual(paragraphBlocks(LONG));
  });

  it("if the served HTML is a Cloudflare challenge, renders instead of extracting it", async () => {
    vi.mocked(fetchText).mockResolvedValue(CHALLENGE_HTML);
    vi.mocked(renderPageHtml).mockResolvedValue(page(LONG, false));

    const chapter = await fetchTruyenfullChapter(CHAPTER_URL);

    expect(renderPageHtml).toHaveBeenCalledWith(CHAPTER_URL);
    expect(chapter.blocks).toEqual(paragraphBlocks(LONG));
  });

  it("if the render is still a Cloudflare challenge, says to import a session", async () => {
    vi.mocked(fetchText).mockRejectedValue(new Error("Failed to fetch (HTTP 403)"));
    vi.mocked(renderPageHtml).mockResolvedValue(CHALLENGE_HTML);

    await expect(fetchTruyenfullChapter(CHAPTER_URL)).rejects.toThrow(
      /Cloudflare check the app cannot pass on its own/
    );
  });

  it("if the saved session is no longer accepted, says to re-import it", async () => {
    vi.mocked(fetchText).mockRejectedValue(new Error("Failed to fetch (HTTP 403)"));
    vi.mocked(renderPageHtml).mockResolvedValue(CHALLENGE_HTML);
    mockedLoadSession.mockReturnValue({ cookies: [], origins: [] });

    await expect(fetchTruyenfullChapter(CHAPTER_URL)).rejects.toThrow(
      /Saved session is no longer accepted by Cloudflare/
    );
  });

  it("sends the saved session's user agent and cookies on the fast path", async () => {
    mockedSessionHeaders.mockReturnValue({ "User-Agent": "UA-MAC", Cookie: "cf_clearance=abc" });
    vi.mocked(fetchText).mockResolvedValue(page(LONG));

    await fetchTruyenfullChapter(CHAPTER_URL);

    expect(fetchText).toHaveBeenCalledWith(CHAPTER_URL, {
      headers: { "User-Agent": "UA-MAC", Cookie: "cf_clearance=abc" },
    });
  });

  it("if rendering fails, the error propagates", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(["Đang tải..."]));
    vi.mocked(renderPageHtml).mockRejectedValue(new Error("Page blanked before content could be read"));

    await expect(fetchTruyenfullChapter(CHAPTER_URL)).rejects.toThrow("Page blanked");
  });

  it("if chapter is locked, reports immediately, does not waste extra render", async () => {
    vi.mocked(fetchText).mockResolvedValue(page([...LONG, LOCKED_TEXT]));

    await expect(fetchTruyenfullChapter(CHAPTER_URL)).rejects.toBeInstanceOf(LockedContentError);
    expect(renderPageHtml).not.toHaveBeenCalled();
  });

  it("if the rendered chapter is locked, reports LockedContentError", async () => {
    vi.mocked(fetchText).mockResolvedValue(page(["Đang tải..."]));
    vi.mocked(renderPageHtml).mockResolvedValue(page([...LONG, LOCKED_TEXT], false));

    await expect(fetchTruyenfullChapter(CHAPTER_URL)).rejects.toBeInstanceOf(LockedContentError);
  });
});
