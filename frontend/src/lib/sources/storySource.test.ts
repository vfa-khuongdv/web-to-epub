import { describe, expect, it } from "vitest";
import { storySourceLabel } from "./storySource";

const t = (key: string) => key;

describe("storySourceLabel", () => {
  it("shows the crawl site's own name", () => {
    expect(storySourceLabel({ site: "XTruyện", storyUrl: "https://xtruyen.vn/a/" }, t)).toBe("XTruyện");
  });

  it("names an imported book by where it came from", () => {
    expect(storySourceLabel({ site: "epub", storyUrl: "pdf:abc" }, t)).toBe("PDF file");
    expect(storySourceLabel({ site: "epub", storyUrl: "archive:some-item" }, t)).toBe("Internet Archive");
    expect(storySourceLabel({ site: "epub", storyUrl: "dtv:123" }, t)).toBe("DTV Ebook");
    expect(storySourceLabel({ site: "epub", storyUrl: "epub:abc" }, t)).toBe("EPUB file");
  });
});
