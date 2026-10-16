import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchText } from "../../services/toc/http";
import { fetchTruyendecuChapter, parseChapter } from "./chapter";

vi.mock("../../services/toc/http", () => ({ fetchText: vi.fn() }));

const mockedFetchText = vi.mocked(fetchText);
const readFixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");
const URL2 = "https://truyendecu.store/truyen/roi-khoi-luc-canh-tham/chuong-2/";
const texts = (c: { blocks: { text?: string }[] }) => c.blocks.map((b) => b.text ?? "").join("\n");

beforeEach(() => mockedFetchText.mockReset());

describe("truyendecu chapter", () => {
  it("chương bị khoá: gọi story_get_full_chapter và lấy toàn bộ, bỏ quảng cáo", async () => {
    mockedFetchText
      .mockResolvedValueOnce(readFixture("chapter-locked.html"))
      .mockResolvedValueOnce(JSON.stringify({ success: true, data: { content: readFixture("chapter-full.html") } }));
    const chapter = await fetchTruyendecuChapter(URL2);
    expect(String(mockedFetchText.mock.calls[1][0])).toContain("action=story_get_full_chapter&chapter_id=12083");
    expect(chapter.title).toBe("Chương 2");
    const text = texts(chapter);
    expect(text).toContain("Quà tân hôn. Tặng trước.");
    expect(text).not.toContain("Quạt Cầm Tay");
    expect(text).not.toContain("Có thể bạn thích");
    expect(text.length).toBeGreaterThan(texts(parseChapter(URL2, readFixture("chapter-locked.html"))).length);
  });

  it("chương không có lớp phủ: đọc thẳng từ trang, không gọi AJAX", async () => {
    mockedFetchText.mockResolvedValueOnce(readFixture("chapter-locked.html").replace("storyAdsOverlay", "x"));
    const chapter = await fetchTruyendecuChapter(URL2);
    expect(mockedFetchText).toHaveBeenCalledTimes(1);
    expect(chapter.blocks.length).toBeGreaterThan(5);
  });

  it("AJAX không trả nội dung thì báo lỗi thay vì lưu chương cụt", async () => {
    mockedFetchText
      .mockResolvedValueOnce(readFixture("chapter-locked.html"))
      .mockResolvedValueOnce(JSON.stringify({ success: false }));
    await expect(fetchTruyendecuChapter(URL2)).rejects.toThrow();
  });
});
