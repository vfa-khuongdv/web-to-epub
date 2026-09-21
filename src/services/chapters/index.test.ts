import { describe, expect, it } from "vitest";
import { getChapterFetcher } from "./index";
import { fetchTruyenfullChapter } from "./truyenfull";
import { fetchWattpadChapter } from "./wattpad";

describe("getChapterFetcher", () => {
  it("chọn fetcher theo hostname, bỏ tiền tố www", () => {
    expect(getChapterFetcher("https://www.wattpad.com/148415654-a")?.fetchChapter).toBe(fetchWattpadChapter);
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
