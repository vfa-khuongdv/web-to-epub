import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeWattpadStoryUrl, parseWattpadStory, parseWattpadStoryId } from "./wattpad";

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

describe("parseWattpadStoryId", () => {
  it("lấy id từ URL truyện có slug", () => {
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431-pumpkin-patch-princess")).toBe("44634431");
  });

  it("lấy id khi URL không slug, có dấu / cuối hoặc query", () => {
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431")).toBe("44634431");
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431/")).toBe("44634431");
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431?foo=1")).toBe("44634431");
  });

  it("trả undefined cho URL chương và URL không hợp lệ", () => {
    expect(
      parseWattpadStoryId("https://www.wattpad.com/147847239-pumpkin-patch-princess-chapter-one-the-very-secret")
    ).toBeUndefined();
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
});

describe("parseWattpadStory", () => {
  it("map metadata + toàn bộ parts thành chapters", () => {
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

  it("báo lỗi rõ ràng khi API trả JSON lỗi (truyện không tồn tại)", () => {
    const errorBody = JSON.stringify({ error_code: 1017, error_type: "NotFound", message: "Story not found", fields: ["story_id"] });
    expect(() => parseWattpadStory(errorBody, "https://www.wattpad.com/story/1")).toThrow(/Không tìm thấy truyện/);
  });

  it("báo lỗi khi response không phải JSON", () => {
    expect(() => parseWattpadStory("<html>blocked</html>", "https://www.wattpad.com/story/1")).toThrow(/không phải JSON/);
  });

  it("báo lỗi khi response không có part nào", () => {
    expect(() => parseWattpadStory(JSON.stringify({ id: "1", title: "Truyện", parts: [] }), "https://www.wattpad.com/story/1")).toThrow(
      /danh sách chương/
    );
  });
});
