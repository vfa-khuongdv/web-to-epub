import { describe, expect, it } from "vitest";
import { findSupportedSite, SUPPORTED_SITES } from "./supportedSites";

describe("findSupportedSite", () => {
  it("nhận Wattpad (có/không www)", () => {
    expect(findSupportedSite("https://www.wattpad.com/story/44634431-pumpkin-patch-princess")).toEqual({
      domain: "wattpad.com",
      name: "Wattpad",
    });
    expect(findSupportedSite("https://wattpad.com/148415654-a")?.domain).toBe("wattpad.com");
  });

  it("nhận xtruyen.vn", () => {
    expect(findSupportedSite("https://xtruyen.vn/truyen/han-phu/")).toEqual({
      domain: "xtruyen.vn",
      name: "XTruyện",
    });
    expect(findSupportedSite("https://www.xtruyen.vn/truyen/a/")?.domain).toBe("xtruyen.vn");
  });

  it("nhận truyenfull.vn", () => {
    expect(findSupportedSite("https://truyenfull.vn/dau-xuan-tuoi-sang/")).toEqual({
      domain: "truyenfull.vn",
      name: "TruyenFull",
    });
    expect(findSupportedSite("https://www.truyenfull.vn/truyen/a/")?.domain).toBe("truyenfull.vn");
  });

  it("nhận truyenfull.live (mirror domain)", () => {
    expect(findSupportedSite("https://truyenfull.live/dau-xuan-tuoi-sang/")).toEqual({
      domain: "truyenfull.live",
      name: "TruyenFull",
    });
    expect(findSupportedSite("https://www.truyenfull.live/truyen/a/")?.domain).toBe("truyenfull.live");
  });

  it("nhận truyencom.com", () => {
    expect(findSupportedSite("https://truyencom.com/de-ba.27/")).toEqual({
      domain: "truyencom.com",
      name: "Đọc Truyện",
    });
    expect(findSupportedSite("https://www.truyencom.com/de-ba.27/")?.domain).toBe("truyencom.com");
  });

  it("nhận truyenhoan.com", () => {
    expect(findSupportedSite("https://truyenhoan.com/con-duong-ba-chu.66/")).toEqual({
      domain: "truyenhoan.com",
      name: "Truyện Hoàn",
    });
    expect(findSupportedSite("https://www.truyenhoan.com/con-duong-ba-chu.66/")?.domain).toBe("truyenhoan.com");
  });

  it("nhận subdomain con của supported site", () => {
    expect(findSupportedSite("https://m.wattpad.com/story/123")?.domain).toBe("wattpad.com");
  });

  it("bỏ qua www prefix cho mọi supported site", () => {
    for (const site of SUPPORTED_SITES) {
      expect(findSupportedSite(`https://www.${site.domain}/x`)?.domain).toBe(site.domain);
    }
  });

  it("từ chối domain lạ", () => {
    expect(findSupportedSite("https://example.com/a")).toBeUndefined();
  });

  it("trả undefined cho URL không hợp lệ", () => {
    expect(findSupportedSite("khong-phai-url")).toBeUndefined();
  });

  it("trả undefined cho chuỗi rỗng", () => {
    expect(findSupportedSite("")).toBeUndefined();
  });
});
