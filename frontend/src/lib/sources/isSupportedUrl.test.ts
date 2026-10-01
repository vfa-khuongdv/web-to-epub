import { describe, expect, it } from "vitest";
import { isSupportedUrl } from "./isSupportedUrl";
import { SupportedSite } from "../../types";

const SITES: SupportedSite[] = [
  { domain: "xtruyen.vn", name: "XTruyện", mode: "crawl" },
  { domain: "archive.org", name: "Internet Archive", mode: "import" },
  { domain: "dtv-ebook.com.vn", name: "DTV Ebook", mode: "import" },
];

describe("isSupportedUrl", () => {
  it("khớp domain và subdomain, bỏ www", () => {
    expect(isSupportedUrl("https://xtruyen.vn/truyen/han-phu/", SITES)).toBe(true);
    expect(isSupportedUrl("https://www.xtruyen.vn/truyen/han-phu/", SITES)).toBe(true);
  });

  it("lọc theo mode khi được yêu cầu", () => {
    // The add box must not hand a book-file URL to the crawl path: there is no chapter list.
    expect(isSupportedUrl("https://archive.org/details/x", SITES, "crawl")).toBe(false);
    expect(isSupportedUrl("https://dtv-ebook.com.vn/an-minh_27570.html", SITES, "crawl")).toBe(false);
    expect(isSupportedUrl("https://xtruyen.vn/truyen/a/", SITES, "crawl")).toBe(true);
    // "import" is the other half: a crawl site is not a book file.
    expect(isSupportedUrl("https://xtruyen.vn/truyen/a/", SITES, "import")).toBe(false);
    expect(isSupportedUrl("https://archive.org/details/x", SITES, "import")).toBe(true);
  });

  it("trả false cho URL không hợp lệ", () => {
    expect(isSupportedUrl("khong-phai-url", SITES)).toBe(false);
    expect(isSupportedUrl("https://example.com/x", SITES)).toBe(false);
  });
});
