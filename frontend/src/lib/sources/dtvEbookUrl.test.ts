import { describe, expect, it } from "vitest";
import { dtvEbookId, isDtvEbookUrl } from "./dtvEbookUrl";

describe("dtvEbookUrl", () => {
  it("accepts a DTV Ebook book page", () => {
    expect(dtvEbookId("https://dtv-ebook.com.vn/an-minh-tai-so_27570.html")).toBe("27570");
    expect(dtvEbookId("https://www.dtv-ebook.com.vn/lam-thanh_27399.html")).toBe("27399");
    expect(isDtvEbookUrl("https://dtv-ebook.com.vn/lam-thanh_27399.html")).toBe(true);
  });

  it("rejects other pages of the same site and any other host", () => {
    expect(isDtvEbookUrl("https://dtv-ebook.com.vn/tim-kiem.html?keyword=dau")).toBe(false);
    expect(isDtvEbookUrl("https://dtv-ebook.com.vn/")).toBe(false);
    expect(isDtvEbookUrl("https://example.com/an-minh_27570.html")).toBe(false);
    expect(isDtvEbookUrl("not a url")).toBe(false);
  });
});
