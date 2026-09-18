import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeWattpadStoryUrl, parseWattpadStory, parseWattpadStoryId } from "./wattpad";

const readFixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

describe("parseWattpadStoryId", () => {
  it("extracts id from story URL with slug", () => {
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431-pumpkin-patch-princess")).toBe("44634431");
  });

  it("extracts id when URL has no slug, has trailing / or query", () => {
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431")).toBe("44634431");
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431/")).toBe("44634431");
    expect(parseWattpadStoryId("https://www.wattpad.com/story/44634431?foo=1")).toBe("44634431");
  });

  it("returns undefined for chapter URL and invalid URL", () => {
    expect(
      parseWattpadStoryId("https://www.wattpad.com/147847239-pumpkin-patch-princess-chapter-one-the-very-secret")
    ).toBeUndefined();
    expect(parseWattpadStoryId("không phải url")).toBeUndefined();
  });
});

describe("normalizeWattpadStoryUrl", () => {
  it("normalizes story URL to no-slug form, removes query/hash", () => {
    expect(normalizeWattpadStoryUrl("https://www.wattpad.com/story/44634431-pumpkin-patch-princess/?x=1#top")).toBe(
      "https://www.wattpad.com/story/44634431"
    );
  });

  it("keeps non-story URLs unchanged (fetchToc will report clearly)", () => {
    const chapterUrl = "https://www.wattpad.com/147847239-pumpkin-patch-princess-chapter-one-the-very-secret";
    expect(normalizeWattpadStoryUrl(chapterUrl)).toBe(chapterUrl);
  });
});

describe("parseWattpadStory", () => {
  it("maps metadata + all parts to chapters", () => {
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

  it("reports clear error when API returns error JSON (story not found)", () => {
    const errorBody = JSON.stringify({ error_code: 1017, error_type: "NotFound", message: "Story not found", fields: ["story_id"] });
    expect(() => parseWattpadStory(errorBody, "https://www.wattpad.com/story/1")).toThrow(/Story not found/);
  });

  it("reports error when response is not JSON", () => {
    expect(() => parseWattpadStory("<html>blocked</html>", "https://www.wattpad.com/story/1")).toThrow(/not JSON/);
  });

  it("reports error when response has no parts", () => {
    expect(() => parseWattpadStory(JSON.stringify({ id: "1", title: "Truyện", parts: [] }), "https://www.wattpad.com/story/1")).toThrow(
      /list of chapters/
    );
  });
});
