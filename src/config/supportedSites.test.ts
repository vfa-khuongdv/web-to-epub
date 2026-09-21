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
    // This pins the user-facing expectation (a www host maps to the site), not
    // the `www.` strip itself: subdomain matching (`endsWith("." + domain)`)
    // already accepts www hosts, so removing `.replace(/^www\./, "")` would
    // leave this test green.
    for (const site of SUPPORTED_SITES) {
      expect(findSupportedSite(`https://www.${site.domain}/x`)?.domain).toBe(site.domain);
    }
  });

  it("từ chối domain lạ", () => {
    expect(findSupportedSite("https://example.com/a")).toBeUndefined();
  });

  it("từ chối domain trông giống supported site (ranh giới tin cậy)", () => {
    // The dot in `endsWith("." + domain)` (supportedSites.ts:27) is the trust
    // boundary: a bare suffix like "notwattpad.com" must not pass.
    expect(findSupportedSite("https://notwattpad.com/x")).toBeUndefined();
    expect(findSupportedSite("https://wattpad.com.evil.com/x")).toBeUndefined();
    expect(findSupportedSite("https://truyenfull.vn.evil.com/x")).toBeUndefined();
  });

  it("trả undefined cho FQDN có dấu chấm cuối (fail-closed)", () => {
    // new URL() keeps the trailing dot in hostname (supportedSites.ts:23), so
    // "wattpad.com." matches neither equality nor `.<domain>` (line 27). Pin
    // the fail-closed behavior instead of normalizing the URL.
    expect(findSupportedSite("https://wattpad.com./x")).toBeUndefined();
  });

  it("khớp bất kể scheme, chữ hoa/thường và port", () => {
    expect(findSupportedSite("http://wattpad.com/x")?.domain).toBe("wattpad.com");
    expect(findSupportedSite("https://WattPad.COM/x")?.domain).toBe("wattpad.com");
    expect(findSupportedSite("https://wattpad.com:8443/x")?.domain).toBe("wattpad.com");
  });

  it("trả undefined khi URL parse được nhưng host rỗng", () => {
    // Both parse without throwing and yield hostname "", which then goes
    // through the same comparison path as any other host.
    expect(findSupportedSite("file:///x")).toBeUndefined();
    expect(findSupportedSite("mailto:a@wattpad.com")).toBeUndefined();
  });

  it("trả undefined cho URL không hợp lệ", () => {
    expect(findSupportedSite("khong-phai-url")).toBeUndefined();
  });

  it("trả undefined cho chuỗi rỗng", () => {
    expect(findSupportedSite("")).toBeUndefined();
  });
});
