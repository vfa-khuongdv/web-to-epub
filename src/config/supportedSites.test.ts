import { describe, expect, it } from "vitest";
import { findSupportedSite } from "./supportedSites";

describe("findSupportedSite", () => {
  it("nhận Wattpad (có/không www)", () => {
    expect(findSupportedSite("https://www.wattpad.com/story/44634431-pumpkin-patch-princess")).toEqual({
      domain: "wattpad.com",
      name: "Wattpad",
    });
    expect(findSupportedSite("https://wattpad.com/148415654-a")?.domain).toBe("wattpad.com");
  });

  it("từ chối domain lạ", () => {
    expect(findSupportedSite("https://example.com/a")).toBeUndefined();
  });
});
