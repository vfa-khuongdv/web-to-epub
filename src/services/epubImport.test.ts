import { describe, expect, it } from "vitest";
import { buildEpubFixture, TINY_PNG } from "./__fixtures__/epubFixtures";
import { DrmError, EpubTooLargeError, NotEpubError, parseEpub } from "./epubImport";

// In-memory stand-in for the library's media store: keeps parser tests hermetic.
function imageSink() {
  const stored: { bytes: Buffer; extension: string }[] = [];
  const store = (bytes: Buffer, extension: string) => {
    stored.push({ bytes, extension });
    return `epub-media/0123456789abcdef/img-${stored.length}.${extension}`;
  };
  return { stored, store };
}

describe("parseEpub", () => {
  it("reads metadata, spine order and nav titles from an EPUB3", async () => {
    const bytes = buildEpubFixture({
      version: 3,
      title: "Sách thử",
      author: "Tác giả",
      language: "vi",
      chapters: [
        { id: "ch1", file: "OEBPS/ch1.xhtml", title: "Mở đầu", html: "<h1>Mở đầu</h1><p>Một.</p>" },
        { id: "ch2", file: "OEBPS/ch2.xhtml", title: "Kết", html: "<h1>Kết</h1><p>Hai.</p>" },
      ],
    });

    const book = await parseEpub(bytes);

    expect(book.title).toBe("Sách thử");
    expect(book.author).toBe("Tác giả");
    expect(book.language).toBe("vi");
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Mở đầu", "Kết"]);
    // The leading heading duplicates the title, so it is dropped from the blocks.
    expect(book.chapters[0].blocks).toEqual([{ type: "paragraph", text: "Một." }]);
  });

  it("reads a deflate-compressed EPUB", async () => {
    const bytes = buildEpubFixture({ compressionLevel: 6 });

    const book = await parseEpub(bytes);

    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].blocks).toEqual([{ type: "paragraph", text: "Nội dung một." }]);
  });

  it("reads chapter titles from toc.ncx in an EPUB2", async () => {
    const bytes = buildEpubFixture({
      version: 2,
      chapters: [
        { id: "ch1", file: "OEBPS/ch1.xhtml", title: "Chương một", html: "<p>Một.</p>" },
        { id: "ch2", file: "OEBPS/ch2.xhtml", title: "Chương hai", html: "<p>Hai.</p>" },
      ],
    });

    const book = await parseEpub(bytes);

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Chương một", "Chương hai"]);
  });

  it("falls back to h1, then the file name, when no TOC names a chapter", async () => {
    const bytes = buildEpubFixture({
      chapters: [
        { id: "ch1", file: "OEBPS/ch1.xhtml", html: "<h1>Tựa đề</h1><p>x</p>" },
        { id: "ch2", file: "OEBPS/khong-co-tua.xhtml", html: "<p>y</p>" },
      ],
    });

    const book = await parseEpub(bytes);

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Tựa đề", "khong-co-tua"]);
  });

  it("uses the uploaded file name when the book has no title", async () => {
    const bytes = buildEpubFixture({ title: "" });
    const book = await parseEpub(bytes, { fallbackTitle: "Sach-cua-toi" });
    expect(book.title).toBe("Sach-cua-toi");
  });

  it("stores raster images with a marker src and drops the rest", async () => {
    const { stored, store } = imageSink();
    const bytes = buildEpubFixture({
      chapters: [
        {
          id: "ch1",
          file: "OEBPS/ch1.xhtml",
          html:
            `<p>Ảnh</p><img src="images/pic.png" alt="p"/>` +
            `<img src="images/missing.png"/>` +
            `<img src="images/notes.txt"/>` +
            `<img src="https://example.com/remote.png"/>` +
            `<img src="data:image/png;base64,${TINY_PNG.toString("base64")}" alt="inline"/>`,
        },
      ],
      extraEntries: {
        "OEBPS/images/pic.png": new Uint8Array(TINY_PNG),
        "OEBPS/images/notes.txt": new Uint8Array(Buffer.from("not an image")),
      },
    });

    const book = await parseEpub(bytes, { storeImage: store });

    expect(stored).toHaveLength(2);
    expect(stored[0].extension).toBe("png");
    expect(book.chapters[0].blocks).toEqual([
      { type: "paragraph", text: "Ảnh" },
      { type: "image", src: "epub-media/0123456789abcdef/img-1.png", alt: "p" },
      { type: "image", src: "epub-media/0123456789abcdef/img-2.png", alt: "inline" },
    ]);
  });

  it("strips scripts, event handlers, srcset, inline styles, local and script links", async () => {
    const { stored, store } = imageSink();
    const bytes = buildEpubFixture({
      chapters: [
        {
          id: "ch1",
          file: "OEBPS/ch1.xhtml",
          html:
            `<h1>An toàn</h1><script>alert(1)</script>` +
            `<p onclick="steal()" style="color:red">Đoạn <a href="javascript:alert(2)">độc</a>` +
            ` <a href="file:///etc/passwd">tệp</a> <a href="ch2.xhtml">chương sau</a>` +
            ` <a href="https://example.com">web</a>` +
            ` <img src="data:image/png;base64,${TINY_PNG.toString("base64")}" srcset="evil.png 2x" alt="inline"/></p>` +
            `<audio src="sound.mp3"></audio>`,
        },
      ],
    });

    const book = await parseEpub(bytes, { storeImage: store });
    const html = JSON.stringify(book.chapters[0].blocks);

    expect(stored).toHaveLength(1);
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("file:");
    expect(html).not.toContain("ch2.xhtml");
    expect(html).not.toContain("audio");
    expect(html).not.toContain("srcset");
    expect(html).not.toContain("style=");
    expect(html).toContain("epub-media/0123456789abcdef/img-1.png");
    // JSON.stringify escapes attribute quotes, hence the backslashes.
    expect(html).toContain('href=\\"https://example.com\\"');
  });

  it.each(["meta", "properties", "guide"] as const)("extracts the cover pointed at by %s", async (pointedBy) => {
    const bytes = buildEpubFixture({ cover: { file: "OEBPS/cover.png", bytes: TINY_PNG, pointedBy } });

    const book = await parseEpub(bytes);

    expect(book.cover?.extension).toBe("png");
    expect(book.cover?.bytes.equals(TINY_PNG)).toBe(true);
  });

  it("drops Calibre's generated cover page from the chapters", async () => {
    const bytes = buildEpubFixture({
      chapters: [
        { id: "titlepage", file: "OEBPS/titlepage.xhtml", html: '<meta name="calibre:cover" content="true"/><div><svg><image href="cover.jpg"/></svg></div>' },
        { id: "ch1", file: "OEBPS/ch1.xhtml", title: "Chương 1", html: "<h1>Chương 1</h1><p>Nội dung một.</p>" },
      ],
    });
    const book = await parseEpub(bytes);
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Chương 1"]);
  });

  it("has no cover when the book has none", async () => {
    const book = await parseEpub(buildEpubFixture());
    expect(book.cover).toBeUndefined();
  });

  it("rejects an encrypted book but accepts obfuscated fonts", async () => {
    const drm = buildEpubFixture({
      encryptionXml:
        `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`,
    });
    await expect(parseEpub(drm)).rejects.toBeInstanceOf(DrmError);

    const fonts = buildEpubFixture({
      encryptionXml:
        `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>`,
    });
    await expect(parseEpub(fonts)).resolves.toBeTruthy();
  });

  it("rejects files that are not EPUB books", async () => {
    await expect(parseEpub(Buffer.from("definitely not a zip"))).rejects.toBeInstanceOf(NotEpubError);
    await expect(parseEpub(Buffer.alloc(0))).rejects.toBeInstanceOf(NotEpubError);
  });

  it("rejects malformed XML in the container and OPF as not an EPUB", async () => {
    const badContainer = buildEpubFixture({
      extraEntries: { "META-INF/container.xml": new Uint8Array(Buffer.from("<container><rootfiles>")) },
    });
    await expect(parseEpub(badContainer)).rejects.toBeInstanceOf(NotEpubError);

    const badOpf = buildEpubFixture({
      extraEntries: { "OEBPS/content.opf": new Uint8Array(Buffer.from("<package><manifest>")) },
    });
    await expect(parseEpub(badOpf)).rejects.toBeInstanceOf(NotEpubError);
  });

  it("stops when the expanded book passes the cap", async () => {
    const bytes = buildEpubFixture({
      chapters: [{ id: "ch1", file: "OEBPS/ch1.xhtml", html: `<p>${"x".repeat(4096)}</p>` }],
    });

    await expect(parseEpub(bytes, { maxTotalUncompressedBytes: 1024 })).rejects.toBeInstanceOf(EpubTooLargeError);
  });

  it("stops when the book has more entries than the cap", async () => {
    const bytes = buildEpubFixture();

    await expect(parseEpub(bytes, { maxEntries: 2 })).rejects.toBeInstanceOf(EpubTooLargeError);

    const book = await parseEpub(bytes);
    expect(book.chapters).toHaveLength(1);
  });
});
