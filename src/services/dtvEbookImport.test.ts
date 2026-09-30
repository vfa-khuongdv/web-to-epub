import { describe, expect, it, vi } from "vitest";
import { buildEpubFixture, TINY_PNG } from "./__fixtures__/epubFixtures";
import {
  DtvEbookNoEpubError,
  DtvEbookNotFoundError,
  dtvEbookId,
  epubPathFromReader,
  importDtvEbook,
  readerUrl,
} from "./dtvEbookImport";

const EPUB = buildEpubFixture({
  title: "Truyện DTV",
  author: "Tác giả DTV",
  chapters: [{ id: "ch1", file: "OEBPS/ch1.xhtml", title: "Chương 1", html: "<p>Nội dung một.</p>" }],
});

const readerPage = (path: string) =>
  new Response(`<script>window.reader = ePubReader("${path}",{ });</script>`, { status: 200 });

// One mock for both calls an import makes: the epub.js reader page, then the EPUB file.
export function dtvFetch(options: { reader?: () => Response; epub?: () => Response } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/doconline.php")) {
      if (options.reader) return options.reader();
      return readerPage("images/files_2/2026/092026/ten-sach.epub");
    }
    if (options.epub) return options.epub();
    return new Response(new Uint8Array(EPUB));
  });
}

describe("dtvEbookId", () => {
  it("reads the id from a book page URL", () => {
    expect(dtvEbookId("https://dtv-ebook.com.vn/an-minh-tai-so_27570.html")).toBe("27570");
    expect(dtvEbookId("https://www.dtv-ebook.com.vn/lam-thanh_27399.html")).toBe("27399");
    expect(dtvEbookId("https://dtv-ebook.com.vn/tim-kiem.html?keyword=dau")).toBeUndefined();
    expect(dtvEbookId("https://example.com/an-minh_27570.html")).toBeUndefined();
    expect(dtvEbookId("not a url")).toBeUndefined();
  });
});

describe("readerUrl", () => {
  it("passes the id as the base64 hash the site's own 'Đọc online' link uses", () => {
    expect(readerUrl("27570")).toBe("https://dtv-ebook.com.vn/doconline.php?hash=Mjc1NzA=");
    expect(readerUrl("841")).toBe("https://dtv-ebook.com.vn/doconline.php?hash=ODQx");
  });
});

describe("epubPathFromReader", () => {
  it("reads the file path out of the epub.js call", () => {
    expect(epubPathFromReader('<script>ePubReader("images/files_2/2026/a.epub",{})</script>')).toBe(
      "images/files_2/2026/a.epub"
    );
  });

  it("has no path when the site ships no online reader for the book", () => {
    // What the site answers for a book that only offers MOBI/CBZ downloads.
    expect(epubPathFromReader('<script>window.reader = ePubReader("",{ });</script>')).toBeUndefined();
    expect(epubPathFromReader("<html><body>Không có gì</body></html>")).toBeUndefined();
  });
});

describe("importDtvEbook", () => {
  it("downloads the EPUB the site hosts and parses it into chapters", async () => {
    const fetchImpl = dtvFetch();
    const book = await importDtvEbook("27570", { fetchImpl, storeImage: (_b: Buffer, e: string) => `epub-media/${e}` });
    expect(book.title).toBe("Truyện DTV");
    expect(book.author).toBe("Tác giả DTV");
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].title).toBe("Chương 1");
    expect(book.chapters[0].blocks[0]).toMatchObject({ type: "paragraph" });
    // The reader page first, then the file it points at.
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://dtv-ebook.com.vn/doconline.php?hash=Mjc1NzA=",
      "https://dtv-ebook.com.vn/images/files_2/2026/092026/ten-sach.epub",
    ]);
  });

  it("keeps the book's cover and stores its chapter images through the media store", async () => {
    const withImage = buildEpubFixture({
      title: "Sách có ảnh",
      chapters: [
        {
          id: "ch1",
          file: "OEBPS/ch1.xhtml",
          title: "Chương 1",
          html: `<p>Chữ.</p><img src="images/pic.png" alt="p"/>`,
        },
      ],
      cover: { file: "OEBPS/cover.png", bytes: TINY_PNG },
      extraEntries: { "OEBPS/images/pic.png": new Uint8Array(TINY_PNG) },
    });
    const stored: string[] = [];
    const book = await importDtvEbook("27570", {
      fetchImpl: dtvFetch({ epub: () => new Response(new Uint8Array(withImage)) }),
      storeImage: (_bytes: Buffer, extension: string) => {
        stored.push(extension);
        return `epub-media/${extension}`;
      },
    });
    expect(book.cover?.extension).toBe("png");
    expect(stored).toEqual(["png"]);
    expect(book.chapters[0].blocks[1]).toMatchObject({ type: "image", src: "epub-media/png" });
  });

  it("reports a book the site has no online EPUB for", async () => {
    await expect(
      importDtvEbook("24274", { fetchImpl: dtvFetch({ reader: () => readerPage("") }) })
    ).rejects.toBeInstanceOf(DtvEbookNoEpubError);
  });

  it("reports a book id the site does not serve", async () => {
    await expect(
      importDtvEbook("999999", { fetchImpl: dtvFetch({ reader: () => new Response("", { status: 404 }) }) })
    ).rejects.toBeInstanceOf(DtvEbookNotFoundError);
  });

  it("reports a book whose EPUB cannot be downloaded", async () => {
    await expect(
      importDtvEbook("27570", { fetchImpl: dtvFetch({ epub: () => new Response("", { status: 404 }) }) })
    ).rejects.toBeInstanceOf(DtvEbookNotFoundError);
  });

  it("refuses a file over the size cap instead of buffering it", async () => {
    await expect(
      importDtvEbook("27570", {
        fetchImpl: dtvFetch({
          epub: () => new Response(new Uint8Array(EPUB), { headers: { "content-length": "999999999" } }),
        }),
        maxFileBytes: 1024,
      })
    ).rejects.toThrow();
  });
});
