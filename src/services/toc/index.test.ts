import { describe, expect, it } from "vitest";
import { getTocAdapter } from "./index";
import { asianfanficsAdapter } from "./asianfanfics";
import { truyenfullTemplateAdapter } from "./truyenfullTemplate";
import { wattpadAdapter } from "./wattpad";
import { xtruyenAdapter } from "./xtruyen";

describe("getTocAdapter", () => {
  it("chọn adapter theo hostname, bỏ tiền tố www", () => {
    expect(getTocAdapter("https://truyenfull.live/a/")).toBe(truyenfullTemplateAdapter);
    expect(getTocAdapter("https://truyenfull.vn/a/")).toBe(truyenfullTemplateAdapter);
    expect(getTocAdapter("https://www.truyencom.com/de-ba.27/")).toBe(truyenfullTemplateAdapter);
    expect(getTocAdapter("https://truyenhoan.com/truyen/abc/")).toBe(truyenfullTemplateAdapter);
    expect(getTocAdapter("https://xtruyen.vn/truyen/han-phu/")).toBe(xtruyenAdapter);
    expect(getTocAdapter("https://www.wattpad.com/story/44634431-pumpkin-patch-princess")).toBe(wattpadAdapter);
    expect(getTocAdapter("https://www.asianfanfics.com/story/view/1143593/attraction")).toBe(asianfanficsAdapter);
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
