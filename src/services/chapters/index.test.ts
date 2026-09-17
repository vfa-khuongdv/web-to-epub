import { describe, expect, it } from "vitest";
import { getChapterFetcher } from "./index";

describe("getChapterFetcher", () => {
  it("chọn fetcher theo hostname, bỏ tiền tố www", () => {
    expect(getChapterFetcher("https://www.wattpad.com/148415654-a")?.domains).toContain("wattpad.com");
  });

  it("trả undefined cho site dùng renderer chung (truyenfull, site lạ)", () => {
    expect(getChapterFetcher("https://truyenfull.live/a/chuong-1/")).toBeUndefined();
    expect(getChapterFetcher("https://example.com/a/")).toBeUndefined();
  });

  it("trả undefined cho URL không hợp lệ", () => {
    expect(getChapterFetcher("khong-phai-url")).toBeUndefined();
  });
});
