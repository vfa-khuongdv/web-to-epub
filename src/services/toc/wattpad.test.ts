import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchText } from "./http";
import { fetchToc, normalizeWattpadStoryUrl, parseWattpadStory, parseWattpadStoryId } from "./wattpad";

vi.mock("./http", () => ({ fetchText: vi.fn() }));

const mockedFetchText = vi.mocked(fetchText);

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

beforeEach(() => {
  mockedFetchText.mockReset();
});

describe("parseWattpadStoryId", () => {
  it("lấy id từ URL truyện có slug", () => {
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431-pumpkin-patch-princess")).toBe("44634431");
  });

  it("lấy id khi URL không slug, có / cuối hoặc query", () => {
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431")).toBe("44634431");
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431/")).toBe("44634431");
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431?foo=1")).toBe("44634431");
  });

  it("trả undefined cho URL chương, URL tương đối và URL không hợp lệ", () => {
    expect(
      parseWattpadStoryId("https://www.wattpad.com/147847239-pumpkin-patch-princess-chapter-one-the-very-secret")
    ).toBeUndefined();
    expect(parseWattpadStoryId("/story/abc")).toBeUndefined();
    expect(parseWattpadStoryId("https://www.wattpad.com/story/abc")).toBeUndefined();
    expect(parseWattpadStoryId("không phải url")).toBeUndefined();
  });
});

describe("normalizeWattpadStoryUrl", () => {
  it("chuẩn hoá URL truyện về dạng không slug, bỏ query/hash", () => {
    expect(normalizeWattpadStoryUrl("https://www.wattpad.com/story/44634431-pumpkin-patch-princess/?x=1#top")).toBe(
      "https://www.wattpad.com/story/44634431"
    );
  });

  it("giữ nguyên URL không phải trang truyện (fetchToc sẽ báo lỗi rõ ràng)", () => {
    const chapterUrl = "https://www.wattpad.com/147847239-pumpkin-patch-princess-chapter-one-the-very-secret";
    expect(normalizeWattpadStoryUrl(chapterUrl)).toBe(chapterUrl);
  });

  it("giữ nguyên URL không hợp lệ", () => {
    expect(normalizeWattpadStoryUrl("không phải url")).toBe("không phải url");
  });
});

describe("parseWattpadStory", () => {
  it("map metadata + toàn bộ part thành chapter", () => {
    const toc = parseWattpadStory(readFixture("wattpad-story.json"), "https://www.wattpad.com/story/44634431");
    expect(toc.title).toBe("Pumpkin Patch Princess");
    expect(toc.author).toBe("juliecdao");
    expect(toc.coverUrl).toBe("https://img.wattpad.com/cover/44634431-256-k926872.jpg");
    expect(toc.chapters).toHaveLength(30);
    expect(toc.chapters[0]).toEqual({
      url: "https://www.wattpad.com/177433975-pumpkin-patch-princess-author%27s-notes-and",
      title: "Author's Notes and Copyright",
    });
    expect(toc.chapters[29].title).toBe("THANK YOU FOR READING!");
  });

  it("dùng URL làm title khi part thiếu title rỗng, trim title thừa", () => {
    const body = JSON.stringify({
      parts: [
        { url: "https://www.wattpad.com/1-a" },
        { url: "https://www.wattpad.com/2-b", title: "  Chương 2  " },
        { url: "https://www.wattpad.com/3-c", title: "   " },
      ],
    });

    const toc = parseWattpadStory(body, "https://www.wattpad.com/story/1");

    expect(toc.chapters).toEqual([
      { url: "https://www.wattpad.com/1-a", title: "https://www.wattpad.com/1-a" },
      { url: "https://www.wattpad.com/2-b", title: "Chương 2" },
      { url: "https://www.wattpad.com/3-c", title: "https://www.wattpad.com/3-c" },
    ]);
  });

  it('fallback title "Untitled", author/cover undefined khi thiếu', () => {
    const toc = parseWattpadStory(
      JSON.stringify({ parts: [{ url: "https://www.wattpad.com/1-a" }] }),
      "https://www.wattpad.com/story/1"
    );

    expect(toc.title).toBe("Untitled");
    expect(toc.author).toBeUndefined();
    expect(toc.coverUrl).toBeUndefined();
  });

  it("lọc part có url rỗng", () => {
    const body = JSON.stringify({ parts: [{ url: "" }, { url: "https://www.wattpad.com/1-a" }] });

    expect(parseWattpadStory(body, "https://www.wattpad.com/story/1").chapters).toEqual([
      { url: "https://www.wattpad.com/1-a", title: "https://www.wattpad.com/1-a" },
    ]);
  });

  it("parts thiếu hoặc không phải mảng đều báo không có chapter", () => {
    for (const parts of [null, "x", 42]) {
      expect(() => parseWattpadStory(JSON.stringify({ parts }), "https://www.wattpad.com/story/1")).toThrow(
        /No chapter list found/
      );
    }
    expect(() => parseWattpadStory(JSON.stringify({ title: "Truyện" }), "https://www.wattpad.com/story/1")).toThrow(
      /No chapter list found/
    );
  });

  it("báo lỗi rõ ràng khi API trả error JSON (không tìm thấy truyện)", () => {
    const errorBody = JSON.stringify({ error_code: 1017, error_type: "NotFound", message: "Story not found", fields: ["story_id"] });
    expect(() => parseWattpadStory(errorBody, "https://www.wattpad.com/story/1")).toThrow(/Story not found/);
  });

  it("NotFound không có message vẫn rõ nghĩa", () => {
    expect(() => parseWattpadStory(JSON.stringify({ error_type: "NotFound" }), "https://www.wattpad.com/story/1")).toThrow(
      /Story not found on Wattpad/
    );
  });

  it("error_type khác NotFound dùng thông báo chung, kèm message nếu có", () => {
    expect(() =>
      parseWattpadStory(JSON.stringify({ error_type: "ServerError" }), "https://www.wattpad.com/story/1")
    ).toThrow(/Wattpad API error \(ServerError\)/);
    expect(() =>
      parseWattpadStory(JSON.stringify({ error_type: "ServerError", message: "boom" }), "https://www.wattpad.com/story/1")
    ).toThrow(/Wattpad API error \(ServerError\): boom/);
  });

  it("báo lỗi khi response không phải JSON", () => {
    expect(() => parseWattpadStory("<html>blocked</html>", "https://www.wattpad.com/story/1")).toThrow(/did not return JSON/);
  });

  it("JSON không phải object (null) báo lỗi thân thiện thay vì TypeError", () => {
    expect(() => parseWattpadStory("null", "https://www.wattpad.com/story/1")).toThrow(/did not return JSON/);
  });

  it("báo lỗi khi response không có chapter", () => {
    expect(() => parseWattpadStory(JSON.stringify({ id: "1", title: "Truyện", parts: [] }), "https://www.wattpad.com/story/1")).toThrow(
      /No chapter list found/
    );
  });
});

describe("fetchToc (wattpad)", () => {
  it("gọi API chapter list đúng URL/header rồi map kết quả", async () => {
    mockedFetchText.mockResolvedValue(readFixture("wattpad-story.json"));

    const toc = await fetchToc("https://www.wattpad.com/story/44634431-pumpkin-patch-princess");

    expect(mockedFetchText).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetchText.mock.calls[0];
    expect(url).toBe(
      "https://www.wattpad.com/api/v3/stories/44634431?fields=id,title,user(name),cover,parts(id,title,url)"
    );
    expect(init).toEqual({
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      },
    });
    expect(toc.title).toBe("Pumpkin Patch Princess");
    expect(toc.author).toBe("juliecdao");
    expect(toc.coverUrl).toBe("https://img.wattpad.com/cover/44634431-256-k926872.jpg");
    expect(toc.chapters).toHaveLength(30);
  });

  it("ném lỗi rõ ràng khi URL không phải trang truyện", async () => {
    await expect(
      fetchToc("https://www.wattpad.com/147847239-pumpkin-patch-princess-chapter-one-the-very-secret")
    ).rejects.toThrow(/not a Wattpad story page/);
    expect(mockedFetchText).not.toHaveBeenCalled();
  });
});
