import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildEpubFixture, TINY_PNG } from "./__fixtures__/epubFixtures";
import {
  archiveItemId,
  ArchiveNotBookError,
  ArchiveNotFoundError,
  ArchiveRestrictedError,
  ArchiveTooManyPagesError,
  ArchiveUnavailableError,
  downloadUrl,
  fetchBytes,
  fetchItem,
  importArchiveItem,
  MAX_ARCHIVE_FILE_BYTES,
  pickEpubFile,
  pickPdfFile,
  pickTextFile,
  textToBook,
} from "./archiveImport";
import { MAX_PAGES } from "./pdfImport";

type FakeFile = { name: string; format: string; source?: string; private?: string | boolean; size?: string };

interface ArchiveFetchOptions {
  metadata?: Record<string, unknown> | null;
  files?: FakeFile[];
  bodies?: Record<string, Buffer | string | number>;
  cover?: Buffer | number;
}

// One mock for every archive.org call an import can make: the metadata API, a file
// download, and the item image. A `null` metadata means the endpoint answers 404.
export function archiveFetch(options: ArchiveFetchOptions = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const metadataMatch = /^https:\/\/archive\.org\/metadata\/(.+)$/.exec(url);
    if (metadataMatch) {
      if (options.metadata === null) return new Response("", { status: 404 });
      const metadata = { identifier: decodeURIComponent(metadataMatch[1]), ...options.metadata };
      return new Response(JSON.stringify({ metadata, files: options.files ?? [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const downloadMatch = /^https:\/\/archive\.org\/download\/[^/]+\/(.+)$/.exec(url);
    if (downloadMatch) {
      const body = options.bodies?.[decodeURIComponent(downloadMatch[1])];
      if (body === undefined) return new Response("", { status: 404 });
      if (typeof body === "number") return new Response("", { status: body });
      return new Response(new Uint8Array(typeof body === "string" ? Buffer.from(body) : body));
    }
    if (url.startsWith("https://archive.org/services/img/")) {
      const cover = options.cover;
      if (typeof cover === "number") return new Response("", { status: cover });
      if (cover) return new Response(new Uint8Array(cover));
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("archiveItemId", () => {
  it("reads the id from the accepted URL shapes", () => {
    expect(archiveItemId("https://archive.org/details/storekeeper0000pear")).toBe("storekeeper0000pear");
    expect(archiveItemId("https://archive.org/details/namiya0000higa/page/n5/mode/2up")).toBe("namiya0000higa");
    expect(archiveItemId("https://archive.org/metadata/proceedings1922mcle")).toBe("proceedings1922mcle");
    expect(archiveItemId("https://www.archive.org/download/alice/alice.pdf")).toBe("alice");
  });

  it("rejects other hosts and paths", () => {
    expect(archiveItemId("https://example.com/details/x")).toBeUndefined();
    expect(archiveItemId("https://archive.org/search?query=alice")).toBeUndefined();
    expect(archiveItemId("https://archive.org/details/")).toBeUndefined();
    expect(archiveItemId("not a url")).toBeUndefined();
  });
});

describe("fetchItem", () => {
  it("returns the catalog fields and public files", async () => {
    const fetchImpl = archiveFetch({
      metadata: { title: "The Storekeeper", creator: "Pearson, Tracey Campbell", language: "eng", mediatype: "texts" },
      files: [{ name: "book_djvu.txt", format: "DjVuTXT" }],
    });
    const item = await fetchItem(fetchImpl, "storekeeper0000pear");
    expect(item).toMatchObject({
      id: "storekeeper0000pear",
      title: "The Storekeeper",
      author: "Pearson, Tracey Campbell",
      language: "eng",
      pdfDegraded: false,
    });
    expect(item.files).toHaveLength(1);
  });

  it("refuses a lending item before looking at files", async () => {
    const fetchImpl = archiveFetch({
      metadata: { "access-restricted-item": "true" },
      files: [{ name: "x_djvu.txt", format: "DjVuTXT" }],
    });
    await expect(fetchItem(fetchImpl, "x")).rejects.toBeInstanceOf(ArchiveRestrictedError);
  });

  it("answers not-found for an unknown item", async () => {
    await expect(fetchItem(archiveFetch({ metadata: null }), "missing")).rejects.toBeInstanceOf(ArchiveNotFoundError);
    const empty = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(fetchItem(empty as unknown as typeof fetch, "missing")).rejects.toBeInstanceOf(ArchiveNotFoundError);
  });

  it("refuses a non-text mediatype", async () => {
    const fetchImpl = archiveFetch({ metadata: { mediatype: "audio" } });
    await expect(fetchItem(fetchImpl, "song")).rejects.toBeInstanceOf(ArchiveNotBookError);
  });
});

describe("archive file picking", () => {
  it("prefers an original EPUB and skips LCP, private and oversized files", () => {
    const files: FakeFile[] = [
      { name: "book_lcp.epub", format: "EPUB" },
      { name: "book.epub", format: "EPUB", source: "derivative", size: "1000" },
      { name: "book_orig.epub", format: "EPUB", source: "original", size: "2000" },
      { name: "big.epub", format: "EPUB", source: "original", size: String(MAX_ARCHIVE_FILE_BYTES + 1) },
      { name: "secret.epub", format: "EPUB", private: "true" },
    ];
    expect(pickEpubFile(files, MAX_ARCHIVE_FILE_BYTES)?.name).toBe("book_orig.epub");
  });

  it("prefers the OCR text file and the derivative Text PDF", () => {
    const text = pickTextFile(
      [
        { name: "book_hocr_searchtext.txt.gz", format: "OCR Search Text" },
        { name: "book_djvu.txt", format: "DjVuTXT" },
      ],
      MAX_ARCHIVE_FILE_BYTES
    );
    expect(text?.name).toBe("book_djvu.txt");

    const pdf = pickPdfFile(
      [
        { name: "book_encrypted.pdf", format: "ACS Encrypted PDF" },
        { name: "book_orig.pdf", format: "Text PDF" },
        { name: "book.pdf", format: "Additional Text PDF" },
      ],
      { degraded: false, maxBytes: MAX_ARCHIVE_FILE_BYTES }
    );
    expect(pdf?.name).toBe("book_orig.pdf");
  });

  it("gives up on a degraded PDF", () => {
    expect(pickPdfFile([{ name: "book.pdf", format: "Text PDF" }], { degraded: true })).toBeUndefined();
  });
});

describe("fetchBytes", () => {
  const impl = (res: Response | Error) =>
    vi.fn(async () => {
      if (res instanceof Error) throw res;
      return res;
    }) as unknown as typeof fetch;

  it("returns the body bytes", async () => {
    const bytes = await fetchBytes(impl(new Response(new Uint8Array(Buffer.from("hello")))), "https://x", 1024);
    expect(bytes?.toString()).toBe("hello");
  });

  it("returns undefined for HTTP errors and network failures", async () => {
    expect(await fetchBytes(impl(new Response("", { status: 403 })), "https://x", 1024)).toBeUndefined();
    expect(await fetchBytes(impl(new TypeError("fetch failed")), "https://x", 1024)).toBeUndefined();
  });

  it("cuts a response that runs past the cap", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    expect(await fetchBytes(impl(new Response(stream)), "https://x", 10)).toBeUndefined();
  });

  it("refuses a declared size over the cap without reading it", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(4));
      },
    });
    // A default stream runs its first pull on a microtask at construction, before
    // fetchBytes is called; wait that out, then require that fetchBytes pulls none.
    await Promise.resolve();
    const pullsBefore = pulls;
    const res = { ok: true, headers: new Headers({ "content-length": "999" }), body: stream } as unknown as Response;
    expect(await fetchBytes(impl(res), "https://x", 100)).toBeUndefined();
    expect(pulls).toBe(pullsBefore);
  });
});

describe("textToBook", () => {
  it("splits on chapter headings and rebuilds paragraphs", () => {
    const text = ["Chapter 1", "It was a dark night.", "The wind howled.", "Chapter 2", "Morning came slow."].join("\n");
    const book = textToBook(text, { title: "Sách" });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(book.chapters[0].blocks).toEqual([
      { type: "paragraph", text: "It was a dark night." },
      { type: "paragraph", text: "The wind howled." },
    ]);
  });

  it("keeps the text before the first chapter as its own chapter", () => {
    const text = ["Title page words.", "Chapter 1", "Body line.", "Chapter 2", "More body."].join("\n");
    const book = textToBook(text, { title: "Sách" });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Sách", "Chapter 1", "Chapter 2"]);
  });

  it("starts a new paragraph on an indented line", () => {
    const text = [
      "Chapter 1",
      "First line of the page continues here.",
      "   Indented new paragraph starts here.",
      "Chapter 2",
      "End.",
    ].join("\n");
    const book = textToBook(text, { title: "Sách" });
    expect(book.chapters[0].blocks).toEqual([
      { type: "paragraph", text: "First line of the page continues here." },
      { type: "paragraph", text: "Indented new paragraph starts here." },
    ]);
  });

  it("joins hyphen-broken words and drops bare page numbers at page edges", () => {
    const text = "1\nsome-\nthing continued here\n42";
    const book = textToBook(text, { title: "Sách" });
    expect(book.chapters[0].blocks).toEqual([{ type: "paragraph", text: "something continued here" }]);
  });

  it("falls back to 20-page chunks when there are no chapter headings", () => {
    const text = Array.from({ length: 25 }, (_, index) => `Page ${index + 1} has text.`).join("\n\f");
    const book = textToBook(text, { title: "Sách" });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Pages 1–20", "Pages 21–25"]);
  });

  it("refuses a book past the page cap", () => {
    const text = Array.from({ length: MAX_PAGES + 1 }, () => "text").join("\n\f");
    expect(() => textToBook(text, { title: "Sách" })).toThrow(ArchiveTooManyPagesError);
  });
});

describe("downloadUrl", () => {
  it("encodes the item id and each path segment", () => {
    expect(downloadUrl("a b", "folder/book one.epub")).toBe("https://archive.org/download/a%20b/folder/book%20one.epub");
  });
});

describe("importArchiveItem", () => {
  const epubBytes = buildEpubFixture({
    title: "EPUB title",
    chapters: [{ id: "ch1", file: "OEBPS/ch1.xhtml", title: "Một", html: "<p>Nội dung.</p>" }],
  });

  it("prefers the public EPUB and takes catalog metadata", async () => {
    const fetchImpl = archiveFetch({
      metadata: { title: "Catalog title", creator: "Pearson, Tracey Campbell", language: "eng" },
      files: [
        { name: "book.epub", format: "EPUB", source: "original" },
        { name: "book_djvu.txt", format: "DjVuTXT" },
      ],
      bodies: { "book.epub": epubBytes, "book_djvu.txt": "Chapter 1\ntext" },
    });
    const book = await importArchiveItem("x", { fetchImpl });
    expect(book).toMatchObject({ title: "Catalog title", author: "Pearson, Tracey Campbell", language: "eng" });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Một"]);
  });

  it("falls back to the OCR text when there is no EPUB", async () => {
    // Past MIN_TEXT_CHARS (200 non-space characters), or the PDF fallback would run.
    const text = [
      "Chapter 1",
      "It was a dark night, and the wind howled through the narrow streets.",
      "Nobody was outside, so the storekeeper locked the door early.",
      "She counted the till twice before turning off the lamps.",
      "Chapter 2",
      "Morning came slow, with the first light creeping over the rooftops.",
      "The cat was already waiting by the back door.",
    ].join("\n");
    const fetchImpl = archiveFetch({
      files: [{ name: "book_djvu.txt", format: "DjVuTXT" }],
      bodies: { "book_djvu.txt": text },
    });
    const book = await importArchiveItem("x", { fetchImpl });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2"]);
  });

  it("uses the PDF when the text layer is too thin", async () => {
    const pdf = readFileSync(path.join(__dirname, "__fixtures__", "pdf-scan.pdf"));
    const fetchImpl = archiveFetch({
      files: [
        { name: "book_djvu.txt", format: "DjVuTXT" },
        { name: "book.pdf", format: "Text PDF" },
      ],
      bodies: { "book_djvu.txt": "nearly nothing", "book.pdf": pdf },
    });
    const book = await importArchiveItem("x", {
      fetchImpl,
      storeImage: (bytes, extension) => `media/${extension}/${bytes.length}`,
    });
    const image = book.chapters.flatMap((chapter) => chapter.blocks).find((block) => block.type === "image");
    expect(image?.src).toMatch(/^media\/jpg\//);
  });

  it("adds the item image as the cover", async () => {
    // 20 lines: past MIN_TEXT_CHARS, so the text source is used.
    const text = Array.from({ length: 20 }, (_, index) => `Line ${index} of text.`).join("\n");
    const fetchImpl = archiveFetch({
      files: [{ name: "book_djvu.txt", format: "DjVuTXT" }],
      bodies: { "book_djvu.txt": text },
      cover: TINY_PNG,
    });
    const book = await importArchiveItem("x", { fetchImpl });
    expect(book.cover?.bytes.equals(TINY_PNG)).toBe(true);
  });

  it("answers unavailable when every source is private or missing", async () => {
    const fetchImpl = archiveFetch({
      files: [
        { name: "book.epub", format: "EPUB", private: "true" },
        { name: "book_djvu.txt", format: "DjVuTXT", private: "true" },
      ],
    });
    await expect(importArchiveItem("x", { fetchImpl })).rejects.toBeInstanceOf(ArchiveUnavailableError);
  });
});