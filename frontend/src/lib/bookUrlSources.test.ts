import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ importArchive: vi.fn(), importDtvEbook: vi.fn() }));

import { importArchive, importDtvEbook } from "./api";
import { bookUrlSourceFor } from "./bookUrlSources";

describe("bookUrlSourceFor", () => {
  it("routes an archive.org item to the archive import", () => {
    expect(bookUrlSourceFor("https://archive.org/details/some-book")?.importBook).toBe(importArchive);
  });

  it("routes a DTV Ebook book page to the DTV import", () => {
    expect(bookUrlSourceFor("https://dtv-ebook.com.vn/ten-sach_123.html")?.importBook).toBe(importDtvEbook);
  });

  it("is undefined for crawl sites and for pages of those hosts that are not a book", () => {
    expect(bookUrlSourceFor("https://xtruyen.vn/truyen/a/")).toBeUndefined();
    expect(bookUrlSourceFor("https://archive.org/search?query=x")).toBeUndefined();
    expect(bookUrlSourceFor("https://dtv-ebook.com.vn/")).toBeUndefined();
  });
});
