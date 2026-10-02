import { describe, expect, it } from "vitest";
import { asianfanficsAdapter } from "./asianfanfics/toc";
import { fetchAsianfanficsChapter } from "./asianfanfics/chapter";
import { getChapterFetcher, getTocAdapter, IMPORT_SOURCES, SESSION_SITES, SITES, SUPPORTED_SITES } from "./index";
import { fetchScribdChapter } from "./scribd/chapter";
import { scribdAdapter } from "./scribd/toc";
import { fetchTruyenfullChapter } from "./truyenfull/chapter";
import { truyenfullTemplateAdapter } from "./truyenfull/toc";
import { fetchVietmessengerChapter } from "./vietmessenger/chapter";
import { vietmessengerAdapter } from "./vietmessenger/toc";
import { fetchWattpadChapter } from "./wattpad/chapter";
import { wattpadAdapter } from "./wattpad/toc";
import { xtruyenAdapter } from "./xtruyen/toc";

describe("getTocAdapter", () => {
  it("chọn adapter theo hostname, bỏ tiền tố www", () => {
    expect(getTocAdapter("https://truyenfull.live/a/")).toBe(truyenfullTemplateAdapter);
    expect(getTocAdapter("https://truyenfull.vn/a/")).toBe(truyenfullTemplateAdapter);
    expect(getTocAdapter("https://www.truyencom.com/de-ba.27/")).toBe(truyenfullTemplateAdapter);
    expect(getTocAdapter("https://truyenhoan.com/truyen/abc/")).toBe(truyenfullTemplateAdapter);
    expect(getTocAdapter("https://xtruyen.vn/truyen/han-phu/")).toBe(xtruyenAdapter);
    expect(getTocAdapter("https://www.wattpad.com/story/44634431-pumpkin-patch-princess")).toBe(wattpadAdapter);
    expect(getTocAdapter("https://www.asianfanfics.com/story/view/1143593/attraction")).toBe(asianfanficsAdapter);
    expect(getTocAdapter("https://vietmessenger.com/books/?title=2030")).toBe(vietmessengerAdapter);
    expect(getTocAdapter("https://www.scribd.com/document/571686127/%E3%83%8A%E3%83%9F")).toBe(scribdAdapter);
  });

  it("hostname không phân biệt hoa/thường", () => {
    expect(getTocAdapter("https://WATTPAD.COM/story/1")).toBe(wattpadAdapter);
    expect(getTocAdapter("https://WWW.TRUYENFULL.VN/a/")).toBe(truyenfullTemplateAdapter);
  });

  it("trả undefined cho site không có adapter", () => {
    expect(getTocAdapter("https://example.com/a/")).toBeUndefined();
  });

  it("trả undefined cho URL không hợp lệ", () => {
    expect(getTocAdapter("khong-phai-url")).toBeUndefined();
  });
});

describe("getChapterFetcher", () => {
  it("chọn fetcher theo hostname, bỏ tiền tố www", () => {
    expect(getChapterFetcher("https://www.wattpad.com/148415654-a")?.fetchChapter).toBe(fetchWattpadChapter);
    expect(getChapterFetcher("https://www.asianfanfics.com/story/view/1143593/1/attraction")?.fetchChapter).toBe(
      fetchAsianfanficsChapter
    );
    expect(getChapterFetcher("https://vietmessenger.com/books/?title=2030&page=2")?.fetchChapter).toBe(
      fetchVietmessengerChapter
    );
    expect(getChapterFetcher("https://www.scribd.com/document/571686127#pages=1-20")?.fetchChapter).toBe(
      fetchScribdChapter
    );
  });

  it("chọn fetcher khi hostname viết hoa", () => {
    expect(getChapterFetcher("https://WWW.WATTPAD.COM/148415654-a")?.fetchChapter).toBe(fetchWattpadChapter);
  });

  it("chọn fetcher truyenfull cho mọi tên miền của site", () => {
    for (const domain of ["truyenfull.live", "truyenfull.vn", "truyenhoan.com"]) {
      const fetcher = getChapterFetcher(`https://${domain}/a/chuong-1/`);
      expect(fetcher?.fetchChapter).toBe(fetchTruyenfullChapter);
      expect(fetcher?.domains).toContain(domain);
    }
  });

  it("chỉ khớp hostname chính xác — loại domain giả mạo và subdomain khác", () => {
    expect(getChapterFetcher("https://notwattpad.com/148415654-a")).toBeUndefined();
    expect(getChapterFetcher("https://wattpad.com.evil.com/148415654-a")).toBeUndefined();
    expect(getChapterFetcher("https://truyenfull.live.evil.com/a/chuong-1/")).toBeUndefined();
    expect(getChapterFetcher("https://m.wattpad.com/148415654-a")).toBeUndefined();
  });

  it("trả undefined cho site dùng renderer chung (xtruyen, site lạ)", () => {
    expect(getChapterFetcher("https://xtruyen.vn/truyen/a/chuong-1/")).toBeUndefined();
    expect(getChapterFetcher("https://example.com/a/")).toBeUndefined();
  });

  it("trả undefined cho URL không hợp lệ", () => {
    expect(getChapterFetcher("khong-phai-url")).toBeUndefined();
  });
});

describe("registry", () => {
  it("lists the crawl allowlist in the order the add box shows it", () => {
    expect(SUPPORTED_SITES.map((site) => site.domain)).toEqual([
      "xtruyen.vn",
      "truyenfull.vn",
      "truyenfull.live",
      "truyencom.com",
      "truyenhoan.com",
      "wattpad.com",
      "asianfanfics.com",
      "fanfiction.net",
      "vietmessenger.com",
      "scribd.com",
      "royalroad.com",
      "docln.net",
      "truyenfullok.com",
    ]);
  });

  it("keeps book-file sources out of the crawl allowlist", () => {
    expect(IMPORT_SOURCES.map((site) => site.domain)).toEqual(["archive.org", "dtv-ebook.com.vn", "heyzine.com"]);
    const crawl = new Set(SUPPORTED_SITES.map((site) => site.domain));
    expect(IMPORT_SOURCES.some((site) => crawl.has(site.domain))).toBe(false);
  });

  it("names the sites that can keep a saved browser session", () => {
    expect(SESSION_SITES).toEqual({
      truyenfull: "truyenfull.live",
      asianfanfics: "asianfanfics.com",
      scribd: "scribd.com",
      archive: "archive.org",
    });
  });

  it("gives every site a unique id and every adapter/fetcher a domain from its own allowlist or import rows", () => {
    expect(new Set(SITES.map((site) => site.id)).size).toBe(SITES.length);
    for (const site of SITES) {
      const own = new Set([...(site.supported ?? []), ...(site.imports ?? [])].map((row) => row.domain));
      for (const domain of [...(site.toc?.domains ?? []), ...(site.chapter?.domains ?? [])]) {
        expect(own.has(domain), `${site.id}: ${domain}`).toBe(true);
      }
    }
  });
});
