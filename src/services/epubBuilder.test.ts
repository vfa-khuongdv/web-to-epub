import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import { contentDisposition, embedImages, embedMedia, epubFileName, packMedia } from "./epubBuilder";

describe("epubFileName", () => {
  it("preserves Vietnamese with marks", () => {
    expect(epubFileName("Nữ Học Bá Trùng Sinh Thành Nữ Phụ Ở Cổ Đại")).toBe(
      "Nữ Học Bá Trùng Sinh Thành Nữ Phụ Ở Cổ Đại.epub"
    );
  });

  it("replaces invalid characters in filename with space", () => {
    expect(epubFileName('Truyện: "A/B" <1> | 2?')).toBe("Truyện A B 1 2.epub");
  });

  it("collapses extra spaces and trims ends", () => {
    expect(epubFileName("  Hãn   Phu  ")).toBe("Hãn Phu.epub");
  });

  it("uses default name when name empty", () => {
    expect(epubFileName("   ")).toBe("book.epub");
  });

  it("truncates too-long name to not exceed filename limit", () => {
    const name = epubFileName("a".repeat(300));
    expect(name.length).toBeLessThanOrEqual(125);
    expect(name.endsWith(".epub")).toBe(true);
  });
});

describe("contentDisposition", () => {
  it("includes ASCII fallback and UTF-8 percent-encoded version", () => {
    expect(contentDisposition("Nữ Học Bá.epub")).toBe(
      "attachment; filename=\"N_ H_c B_.epub\"; filename*=UTF-8''N%E1%BB%AF%20H%E1%BB%8Dc%20B%C3%A1.epub"
    );
  });

  it("does not let special characters break header", () => {
    const value = contentDisposition(epubFileName('Truyện "A" (b)'));
    expect(value).toContain("filename*=UTF-8''");
    expect(value).toContain('filename="Truy_n A (b).epub"');
    expect(value).not.toContain("\n");
  });
});

describe("embedImages", () => {
  // Valid 1x1 PNG, has enough magic bytes to recognize as image.
  const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "embed-images-test-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps chapter with no images unchanged", async () => {
    const chapters = [{ title: "C1", includeInBook: true, contentHtml: "<p>chữ</p>" }];
    expect(await embedImages(chapters, dir)).toEqual(chapters);
  });

  it("saves image data URI to file and points src to it", async () => {
    const [chapter] = await embedImages(
      [{ title: "C1", includeInBook: true, contentHtml: `<img src="data:image/png;base64,${PNG_BASE64}" alt="a"/>` }],
      dir
    );
    const src = chapter.contentHtml.match(/src="file:\/\/([^"]+)"/)?.[1];
    expect(src).toBeDefined();
    // File extension taken from magic bytes, not URL.
    expect(src!.endsWith(".png")).toBe(true);
    expect(fs.existsSync(src!)).toBe(true);
    expect(chapter.contentHtml).toContain('alt="a"');
  });

  it("completely removes img tag when image not recognized, keeps text", async () => {
    const [chapter] = await embedImages(
      [
        {
          title: "C1",
          includeInBook: true,
          contentHtml: '<p>trước</p><img src="data:image/png;base64,bm90LWFuLWltYWdl" /><p>sau</p>',
        },
      ],
      dir
    );
    // Better to lose image than have EPUB point to non-existent file.
    expect(chapter.contentHtml).toBe("<p>trước</p><p>sau</p>");
  });

  it("removes img tag with src not http or data URI", async () => {
    const [chapter] = await embedImages(
      [{ title: "C1", includeInBook: true, contentHtml: '<p>x</p><img src="/local/a.jpg" />' }],
      dir
    );
    expect(chapter.contentHtml).toBe("<p>x</p>");
  });

  it("loads once for multiple tags using same image", async () => {
    const tag = `<img src="data:image/png;base64,${PNG_BASE64}" />`;
    const [chapter] = await embedImages([{ title: "C1", includeInBook: true, contentHtml: tag + tag }], dir);
    expect(fs.readdirSync(dir)).toHaveLength(1);
    const srcs = [...chapter.contentHtml.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs).toHaveLength(2);
    expect(srcs[0]).toBe(srcs[1]);
  });
});

describe("embedMedia", () => {
  const MP3_DATA_URI = `data:audio/mpeg;base64,${Buffer.from("fake-mp3").toString("base64")}`;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "embed-media-test-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps chapter with no media tags unchanged", async () => {
    const chapters = [{ title: "C1", includeInBook: true, contentHtml: "<p>x</p>" }];
    const result = await embedMedia(chapters, dir);
    expect(result.chapters).toBe(chapters);
    expect(result.media).toEqual([]);
  });

  it("saves media file to disk and points src to path in book", async () => {
    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: `<audio controls src="${MP3_DATA_URI}">x</audio>` }],
      dir
    );
    expect(media).toHaveLength(1);
    expect(media[0].href).toBe("media/0.mp3");
    expect(media[0].mediaType).toBe("audio/mpeg");
    expect(fs.readFileSync(media[0].filePath).toString()).toBe("fake-mp3");
    expect(chapters[0].contentHtml).toBe('<audio controls src="media/0.mp3">Audio file</audio>');
  });

  it("replaces unable-to-load tag with link to source instead of removing", async () => {
    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<p>a</p><audio src="https://x.invalid/s.m3u8"></audio>' }],
      dir
    );
    expect(media).toEqual([]);
    expect(chapters[0].contentHtml).toBe(
      '<p>a</p><p><a href="https://x.invalid/s.m3u8">Audio file</a>: https://x.invalid/s.m3u8</p>'
    );
  });

  it("removes media tag with src not http or data URI", async () => {
    const { chapters } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<p>a</p><video src="/local/a.mp4"></video>' }],
      dir
    );
    expect(chapters[0].contentHtml).toBe("<p>a</p>");
  });

  it("discards file exceeding size limit even if server doesn't declare content-length", async () => {
    // Chunk 1MB: readCapped stops immediately when exceeding limit so reads ~51 chunks.
    // Smaller chunks (65536 chunks 1KB) then just loading into stream takes longer
    // than test timeout.
    const chunk = new Uint8Array(1024 * 1024);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            // Source never ends and doesn't declare content-length — only size limit can stop it.
            controller.enqueue(chunk);
          },
        }),
        { headers: { "content-type": "audio/mpeg" } }
      )) as typeof fetch;
    try {
      const { chapters, media } = await embedMedia(
        [{ title: "C1", includeInBook: true, contentHtml: '<audio src="https://x.example/big.mp3"></audio>' }],
        dir
      );
      expect(media).toEqual([]);
      expect(chapters[0].contentHtml).toContain("<p>");
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("loads once for multiple tags using same file", async () => {
    const tag = `<audio src="${MP3_DATA_URI}"></audio>`;
    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: tag + tag }],
      dir
    );
    expect(media).toHaveLength(1);
    expect([...chapters[0].contentHtml.matchAll(/src="media\/0\.mp3"/g)]).toHaveLength(2);
  });
});

describe("packMedia", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-media-test-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Minimal valid EPUB with epub-gen structure, enough to test patching.
  function fakeEpub(chapterHtml: string): Buffer {
    return Buffer.from(
      zipSync({
        mimetype: [Buffer.from("application/epub+zip"), { level: 0 }],
        "OEBPS/content.opf": Buffer.from(
          '<package><manifest><item id="css" href="style.css" media-type="text/css" /></manifest></package>'
        ),
        "OEBPS/0_c1.xhtml": Buffer.from(chapterHtml),
      })
    );
  }

  it("adds media file, declares in manifest, and returns controls", async () => {
    const filePath = path.join(dir, "media-0.mp3");
    fs.writeFileSync(filePath, "bytes");
    const out = await packMedia(fakeEpub('<body><audio src="media/0.mp3">Audio file</audio></body>'), [
      { href: "media/0.mp3", mediaType: "audio/mpeg", filePath },
    ]);

    const entries = unzipSync(out);
    expect(Buffer.from(entries["OEBPS/media/0.mp3"]).toString()).toBe("bytes");
    expect(Buffer.from(entries["OEBPS/content.opf"]).toString()).toContain(
      '<item id="media_0" href="media/0.mp3" media-type="audio/mpeg" />'
    );
    expect(Buffer.from(entries["OEBPS/0_c1.xhtml"]).toString()).toContain('<audio controls src="media/0.mp3">');
  });

  it("keeps mimetype as first entry and uncompressed", async () => {
    const filePath = path.join(dir, "media-0.mp3");
    fs.writeFileSync(filePath, "bytes");
    const out = await packMedia(fakeEpub("<body><audio src=\"media/0.mp3\"></audio></body>"), [
      { href: "media/0.mp3", mediaType: "audio/mpeg", filePath },
    ]);
    // First entry stored raw: mimetype string is at the very start of zip file.
    expect(out.subarray(30, 38).toString()).toBe("mimetype");
    expect(out.subarray(38, 58).toString()).toBe("application/epub+zip");
  });
});
