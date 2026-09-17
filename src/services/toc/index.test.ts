import { describe, expect, it } from "vitest";
import { getTocAdapter } from "./index";

describe("getTocAdapter", () => {
  it("chọn adapter theo hostname, bỏ tiền tố www", () => {
    expect(getTocAdapter("https://truyenfull.live/a/")?.domains).toContain("truyenfull.live");
    expect(getTocAdapter("https://truyenfull.vn/a/")?.domains).toContain("truyenfull.vn");
    expect(getTocAdapter("https://www.truyencom.com/de-ba.27/")?.domains).toContain("truyencom.com");
    expect(getTocAdapter("https://xtruyen.vn/truyen/han-phu/")?.domains).toContain("xtruyen.vn");
  });

  it("trả undefined cho site không có adapter (metruyenchu, site lạ)", () => {
    expect(getTocAdapter("https://metruyenchu.com/truyen/a/")).toBeUndefined();
    expect(getTocAdapter("https://example.com/a/")).toBeUndefined();
  });

  it("trả undefined cho URL không hợp lệ", () => {
    expect(getTocAdapter("khong-phai-url")).toBeUndefined();
  });
});
