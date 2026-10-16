import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchText, sleep } from "../../services/toc/http";
import { fetchToc, parseChapterList, parseStoryId, parseStoryMeta } from "./toc";

vi.mock("../../services/toc/http", () => ({ fetchText: vi.fn(), sleep: vi.fn() }));

const mockedFetchText = vi.mocked(fetchText);
const readFixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");
const STORY = "https://truyendecu.store/truyen/roi-khoi-luc-canh-tham/";
const ajax = (html: string) => JSON.stringify({ success: true, data: { html } });

beforeEach(() => {
  mockedFetchText.mockReset();
  vi.mocked(sleep).mockReset().mockResolvedValue(undefined);
});

describe("truyendecu toc", () => {
  it("đọc mã truyện từ script của trang", () => {
    expect(parseStoryId(readFixture("story.html"))).toBe("12067");
    expect(parseStoryId("<html></html>")).toBeUndefined();
  });

  it("lấy tên (không phải logo), bỏ tác giả 'Đang cập nhật', lấy bìa og:image", () => {
    const meta = parseStoryMeta(readFixture("story.html"), STORY);
    expect(meta.title).toBe("Rời Khỏi Lục Cảnh Thâm");
    expect(meta.author).toBeUndefined();
    expect(meta.coverUrl).toContain("XP305-Roi-Khoi-Luc-Canh-Tham-1.webp");
  });

  it("đọc danh sách chương từ HTML của AJAX", () => {
    const chapters = parseChapterList(readFixture("chapters-page1.html"), STORY);
    expect(chapters).toHaveLength(13);
    expect(chapters[0]).toEqual({ url: `${STORY}chuong-1/`, title: "Chương 1" });
  });

  it("gọi AJAX theo trang tới khi không còn chương mới", async () => {
    mockedFetchText
      .mockResolvedValueOnce(readFixture("story.html"))
      .mockResolvedValueOnce(ajax(readFixture("chapters-page1.html")))
      .mockResolvedValueOnce(ajax('<p class="text-sm">Không tìm thấy chương nào.</p>'));
    const toc = await fetchToc(STORY);
    expect(toc.chapters).toHaveLength(13);
    const body = String(mockedFetchText.mock.calls[1][1]?.body);
    expect(body).toContain("action=story_core_load_frontend_chapters");
    expect(body).toContain("story_id=12067");
    expect(String(mockedFetchText.mock.calls[2][1]?.body)).toContain("paged=2");
  });

  it("báo lỗi khi không có chương", async () => {
    mockedFetchText.mockResolvedValueOnce(readFixture("story.html")).mockResolvedValueOnce(ajax("<p>none</p>"));
    await expect(fetchToc(STORY)).rejects.toThrow();
  });
});
