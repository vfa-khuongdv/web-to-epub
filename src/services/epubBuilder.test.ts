import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync, zipSync } from "fflate";
import sharp from "sharp";
import { JSDOM } from "jsdom";
import type { ExportChapter } from "../types";
import {
  buildEpub,
  contentDisposition,
  embedImages,
  embedMedia,
  epubFileName,
  packMedia,
  type BuildProgress,
} from "./epubBuilder";

// epubBuilder loads epub-gen with `import Epub = require("epub-gen")`, which runs
// through Node's real require and ignores vi.mock. The hoisted block runs before the
// imports, so the require cache is poisoned before epubBuilder loads the module: the
// stub records the options it received and writes the `sourceEpub` bytes to outputPath.
const epubGen = vi.hoisted(() => {
  const instances: Array<{ options: Record<string, unknown>; outputPath: string }> = [];
  let epubBytes = Buffer.alloc(0) as Buffer;
  const { writeFileSync } = require("node:fs") as typeof import("node:fs");

  class MockEpub {
    promise: Promise<void>;

    constructor(options: Record<string, unknown>, outputPath: string) {
      instances.push({ options, outputPath });
      writeFileSync(outputPath, epubBytes);
      this.promise = Promise.resolve();
    }
  }

  const resolved = require.resolve("epub-gen");
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: MockEpub,
    children: [],
    paths: [],
  } as unknown as NodeModule;

  return { instances, setBytes: (bytes: Buffer) => (epubBytes = bytes) };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Compression method from the first local file header for `name` (0 = stored, 8 = deflated).
function localHeaderMethod(zip: Buffer, name: string): number {
  for (let offset = 0; offset + 30 <= zip.length; offset++) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) continue;
    const nameLength = zip.readUInt16LE(offset + 26);
    if (zip.subarray(offset + 30, offset + 30 + nameLength).toString() === name) {
      return zip.readUInt16LE(offset + 8);
    }
  }
  return -1;
}

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

  it("truncates name to exactly the 120-character cap before adding extension", () => {
    // MAX_FILENAME_LENGTH = 120 (src/services/epubBuilder.ts:30) applies to the base
    // name; ".epub" is appended afterwards.
    expect(epubFileName("a".repeat(119))).toBe(`${"a".repeat(119)}.epub`);
    expect(epubFileName("a".repeat(120))).toBe(`${"a".repeat(120)}.epub`);
    expect(epubFileName("a".repeat(121))).toBe(`${"a".repeat(120)}.epub`);
  });

  it("can split a surrogate pair when an astral character straddles the limit", () => {
    // slice() counts UTF-16 units, so the emoji (2 units) starting at index 119 is cut in half.
    expect(epubFileName(`${"a".repeat(119)}😀`)).toBe(`${"a".repeat(119)}\uD83D.epub`);
  });
});

describe("contentDisposition", () => {
  it("includes ASCII fallback and UTF-8 percent-encoded version", () => {
    expect(contentDisposition("Nữ Học Bá.epub")).toBe(
      "attachment; filename=\"N_ H_c B_.epub\"; filename*=UTF-8''N%E1%BB%AF%20H%E1%BB%8Dc%20B%C3%A1.epub"
    );
  });

  it("does not let special characters break header", () => {
    expect(contentDisposition(epubFileName('Truyện "A" (b)'))).toBe(
      "attachment; filename=\"Truy_n A (b).epub\"; filename*=UTF-8''Truy%E1%BB%87n%20A%20%28b%29.epub"
    );
  });

  it("escapes quotes and RFC 5987 reserved characters exactly", () => {
    // Source: contentDisposition (src/services/epubBuilder.ts:44-51): quotes become "_" in
    // the ASCII fallback; ' ( ) * in the UTF-8 part become %22 %28 %29 %2A.
    expect(contentDisposition('a"b(c)*d.epub')).toBe(
      "attachment; filename=\"a_b(c)*d.epub\"; filename*=UTF-8''a%22b%28c%29%2Ad.epub"
    );
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

  it("returns empty input unchanged without reporting progress", async () => {
    const progress: BuildProgress[] = [];
    const chapters: ExportChapter[] = [];
    expect(await embedImages(chapters, dir, (p) => progress.push(p))).toBe(chapters);
    expect(progress).toEqual([]);
  });

  it("leaves img tags without src untouched", async () => {
    const chapters = [{ title: "C1", includeInBook: true, contentHtml: '<p>x</p><img alt="no source">' }];
    expect(await embedImages(chapters, dir)).toBe(chapters);
  });

  it("downloads an http image and takes the extension from magic bytes", async () => {
    const bytes = Buffer.from(PNG_BASE64, "base64");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, { headers: { "content-type": "application/octet-stream" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const [chapter] = await embedImages(
      [{ title: "C1", includeInBook: true, contentHtml: '<p>a</p><img src="https://cdn.example/no-extension">' }],
      dir
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(dir)).toEqual(["0.png"]);
    expect(fs.readFileSync(path.join(dir, "0.png")).equals(bytes)).toBe(true);
    expect(chapter.contentHtml).toBe(`<p>a</p><img src="file://${path.join(dir, "0.png")}">`);
  });

  it("falls back to the declared content-type when magic bytes are unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(Buffer.from("not-an-image"), { headers: { "content-type": "image/gif" } }))
    );

    const [chapter] = await embedImages(
      [{ title: "C1", includeInBook: true, contentHtml: '<img src="https://cdn.example/x">' }],
      dir
    );

    expect(fs.readdirSync(dir)).toEqual(["0.gif"]);
    expect(chapter.contentHtml).toBe(`<img src="file://${path.join(dir, "0.gif")}">`);
  });

  it("removes the img tag when the download returns an error status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const [chapter] = await embedImages(
      [{ title: "C1", includeInBook: true, contentHtml: '<p>a</p><img src="https://cdn.example/missing.png">' }],
      dir
    );

    // 404 is not retriable, so the request is made once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(chapter.contentHtml).toBe("<p>a</p>");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("removes the img tag when the download fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const [chapter] = await embedImages(
      [{ title: "C1", includeInBook: true, contentHtml: '<p>a</p><img src="https://cdn.example/x.png">' }],
      dir
    );

    // "fetch failed" without a retriable network code is not retried.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(chapter.contentHtml).toBe("<p>a</p>");
  });

  it("rejects an image whose declared content-length exceeds the 32MB download cap without reading the body", async () => {
    // MAX_IMAGE_DOWNLOAD_BYTES = 32 * 1024 * 1024 (src/services/epubBuilder.ts).
    const res = new Response(Buffer.from(PNG_BASE64, "base64"), {
      headers: { "content-type": "image/png", "content-length": String(32 * 1024 * 1024 + 1) },
    });
    const arrayBuffer = vi.spyOn(Response.prototype, "arrayBuffer");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    const [chapter] = await embedImages(
      [{ title: "C1", includeInBook: true, contentHtml: '<p>a</p><img src="https://cdn.example/declared-big.png">' }],
      dir
    );

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(chapter.contentHtml).toBe("<p>a</p>");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("accepts downloaded images up to the 8MB cap and rejects one byte over", async () => {
    const max = 8 * 1024 * 1024;
    const pngMagic = Buffer.from(PNG_BASE64, "base64").subarray(0, 8);
    const tag = '<img src="https://cdn.example/big">';

    for (const size of [max - 1, max]) {
      const bytes = Buffer.alloc(size);
      pngMagic.copy(bytes);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(bytes, { headers: { "content-type": "image/png" } }))
      );

      const [chapter] = await embedImages([{ title: "C1", includeInBook: true, contentHtml: tag }], dir);

      expect(fs.readdirSync(dir)).toEqual(["0.png"]);
      expect(fs.statSync(path.join(dir, "0.png")).size).toBe(size);
      expect(chapter.contentHtml).toBe(`<img src="file://${path.join(dir, "0.png")}">`);
    }

    // One byte over MAX_IMAGE_BYTES now goes through compression instead of an outright
    // reject — but this fixture is only a magic-byte header padded with zeros, not a real
    // decodable PNG, so sharp fails to parse it and it's dropped just the same.
    const overDir = fs.mkdtempSync(path.join(os.tmpdir(), "embed-images-over-test-"));
    try {
      const over = Buffer.alloc(max + 1);
      pngMagic.copy(over);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(over, { headers: { "content-type": "image/png" } }))
      );

      const [chapter] = await embedImages(
        [{ title: "C1", includeInBook: true, contentHtml: `<p>a</p>${tag}` }],
        overDir
      );

      expect(chapter.contentHtml).toBe("<p>a</p>");
      expect(fs.readdirSync(overDir)).toEqual([]);
    } finally {
      fs.rmSync(overDir, { recursive: true, force: true });
    }
  });

  it("resizes and re-encodes a real oversized image instead of dropping it", async () => {
    // Random noise barely compresses, so a PNG this size reliably lands over
    // MAX_IMAGE_BYTES (8MB) — a stand-in for the full-resolution photos Wattpad
    // "aesthetic" stories embed.
    const width = 2000;
    const height = 1600;
    const raw = randomBytes(width * height * 3);
    const oversized = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    expect(oversized.length).toBeGreaterThan(8 * 1024 * 1024);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(oversized, {
          headers: { "content-type": "image/png", "content-length": String(oversized.length) },
        })
      )
    );

    const [chapter] = await embedImages(
      [{ title: "C1", includeInBook: true, contentHtml: '<img src="https://cdn.example/huge.png">' }],
      dir
    );

    expect(fs.readdirSync(dir)).toEqual(["0.jpg"]);
    expect(fs.statSync(path.join(dir, "0.jpg")).size).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(chapter.contentHtml).toBe(`<img src="file://${path.join(dir, "0.jpg")}">`);
  });

  it("rewrites single-quoted and uppercase src attributes", async () => {
    const [chapter] = await embedImages(
      [{ title: "C1", includeInBook: true, contentHtml: `<IMG SRC='data:image/png;base64,${PNG_BASE64}' />` }],
      dir
    );
    expect(chapter.contentHtml).toBe(`<IMG src="file://${path.join(dir, "0.png")}" />`);
  });

  it("reports monotonic image download progress", async () => {
    const second = Buffer.concat([Buffer.from(PNG_BASE64, "base64"), Buffer.from([0])]).toString("base64");
    const progress: BuildProgress[] = [];

    await embedImages(
      [
        {
          title: "C1",
          includeInBook: true,
          contentHtml: `<img src="data:image/png;base64,${PNG_BASE64}"><img src="data:image/png;base64,${second}">`,
        },
      ],
      dir,
      (p) => progress.push(p)
    );

    expect(progress).toEqual([
      { phase: "images", done: 1, total: 2 },
      { phase: "images", done: 2, total: 2 },
    ]);
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

  it("embeds a local file:// source only from inside an allowed folder", async () => {
    const root = path.join(dir, "audio", "story");
    fs.mkdirSync(root, { recursive: true });
    const inside = path.join(root, "1.mp3");
    const outside = path.join(dir, "secret.mp3");
    fs.writeFileSync(inside, "narration");
    fs.writeFileSync(outside, "not yours");
    const chapters = [
      { title: "C1", includeInBook: true, contentHtml: `<audio src="file://${inside}">N</audio><p>x</p>` },
      { title: "C2", includeInBook: true, contentHtml: `<audio src="file://${outside}">N</audio><p>y</p>` },
      // A sibling folder whose name merely starts with the root's name is still outside.
      { title: "C3", includeInBook: true, contentHtml: `<audio src="file://${root}-evil/1.mp3">N</audio>` },
    ];

    const result = await embedMedia(chapters, dir, undefined, [root]);

    expect(result.media).toHaveLength(1);
    expect(result.media[0].mediaType).toBe("audio/mpeg");
    expect(fs.readFileSync(result.media[0].filePath, "utf8")).toBe("narration");
    expect(result.chapters[0].contentHtml).toContain(`<audio controls src="${result.media[0].href}">`);
    expect(result.chapters[1].contentHtml).toBe("<p>y</p>");
    expect(result.chapters[2].contentHtml).toBe("");
  });

  it("never reads file:// sources when no folder is allowed", async () => {
    const file = path.join(dir, "1.mp3");
    fs.writeFileSync(file, "x");
    const result = await embedMedia([{ title: "C", includeInBook: true, contentHtml: `<audio src="file://${file}">N</audio>` }], dir);
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
    // x.invalid would need a real DNS lookup, so the failure is stubbed in.
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<p>a</p><audio src="https://x.invalid/s.m3u8"></audio>' }],
      dir
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              // Source never ends and doesn't declare content-length — only size limit can stop it.
              controller.enqueue(chunk);
            },
          }),
          { headers: { "content-type": "audio/mpeg" } }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<audio src="https://x.example/big.mp3"></audio>' }],
      dir
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(media).toEqual([]);
    expect(chapters[0].contentHtml).toBe(
      '<p><a href="https://x.example/big.mp3">Audio file</a>: https://x.example/big.mp3</p>'
    );
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("downloads a repeated source once and reuses it for every tag", async () => {
    const tag = `<audio src="${MP3_DATA_URI}"></audio>`;
    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: tag + tag }],
      dir
    );
    expect(media).toHaveLength(1);
    expect(chapters[0].contentHtml).toBe(
      '<audio controls src="media/0.mp3">Audio file</audio><audio controls src="media/0.mp3">Audio file</audio>'
    );
  });

  it("returns empty input unchanged and reports no progress for tags without src", async () => {
    const chapters: ExportChapter[] = [];
    expect((await embedMedia(chapters, dir)).chapters).toBe(chapters);

    const noSrc = [{ title: "C1", includeInBook: true, contentHtml: `<p>x</p><audio></audio>` }];
    const progress: BuildProgress[] = [];
    const result = await embedMedia(noSrc, dir, (p) => progress.push(p));
    expect(result.chapters).toBe(noSrc);
    expect(result.media).toEqual([]);
    expect(progress).toEqual([]);
  });

  it("ignores self-closing audio tags", async () => {
    const chapters = [{ title: "C1", includeInBook: true, contentHtml: `<audio src="${MP3_DATA_URI}" />` }];
    const result = await embedMedia(chapters, dir);
    expect(result.chapters).toBe(chapters);
    expect(result.media).toEqual([]);
  });

  it("handles uppercase AUDIO tags", async () => {
    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: `<AUDIO SRC="${MP3_DATA_URI}"></AUDIO>` }],
      dir
    );
    expect(media).toHaveLength(1);
    expect(chapters[0].contentHtml).toBe('<AUDIO controls src="media/0.mp3">Audio file</AUDIO>');
  });

  it("downloads http media and takes the extension from the content-type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from("http-mp3"), { headers: { "content-type": "audio/mpeg" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<audio src="https://cdn.example/download?id=1"></audio>' }],
      dir
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(media).toHaveLength(1);
    expect(media[0].href).toBe("media/0.mp3");
    expect(media[0].mediaType).toBe("audio/mpeg");
    expect(fs.readFileSync(media[0].filePath).toString()).toBe("http-mp3");
    expect(chapters[0].contentHtml).toBe(
      '<audio controls src="media/0.mp3"><a href="https://cdn.example/download?id=1">Audio file</a></audio>'
    );
  });

  it("stores a video at media/0.mp4 with the video/mp4 media type", async () => {
    const uri = `data:video/mp4;base64,${Buffer.from("fake-mp4").toString("base64")}`;
    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: `<video src="${uri}"></video>` }],
      dir
    );

    expect(media).toHaveLength(1);
    expect(media[0].href).toBe("media/0.mp4");
    expect(media[0].mediaType).toBe("video/mp4");
    expect(fs.readFileSync(media[0].filePath).toString()).toBe("fake-mp4");
    expect(chapters[0].contentHtml).toBe('<video controls src="media/0.mp4">Video file</video>');
  });

  it("indexes multiple sources in first-seen order", async () => {
    const uri = (body: string, mime = "audio/mpeg") =>
      `data:${mime};base64,${Buffer.from(body).toString("base64")}`;
    const { chapters, media } = await embedMedia(
      [
        {
          title: "C1",
          includeInBook: true,
          contentHtml:
            `<audio src="${uri("a")}"></audio>` +
            `<audio src="${uri("b")}"></audio>` +
            `<audio src="${uri("c")}"></audio>` +
            `<video src="${uri("d", "video/mp4")}"></video>`,
        },
      ],
      dir
    );

    expect(media.map((m) => m.href)).toEqual(["media/0.mp3", "media/1.mp3", "media/2.mp3", "media/3.mp4"]);
    expect(media.map((m) => m.mediaType)).toEqual(["audio/mpeg", "audio/mpeg", "audio/mpeg", "video/mp4"]);
    ["a", "b", "c", "d"].forEach((expected, index) => {
      expect(fs.readFileSync(media[index].filePath).toString()).toBe(expected);
    });
    expect(chapters[0].contentHtml).toBe(
      '<audio controls src="media/0.mp3">Audio file</audio>' +
        '<audio controls src="media/1.mp3">Audio file</audio>' +
        '<audio controls src="media/2.mp3">Audio file</audio>' +
        '<video controls src="media/3.mp4">Video file</video>'
    );
  });

  it("reports monotonic media download progress", async () => {
    const first = `data:audio/mpeg;base64,${Buffer.from("one").toString("base64")}`;
    const second = `data:audio/mpeg;base64,${Buffer.from("two").toString("base64")}`;
    const progress: BuildProgress[] = [];

    await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: `<audio src="${first}"></audio><audio src="${second}"></audio>` }],
      dir,
      (p) => progress.push(p)
    );

    expect(progress).toEqual([
      { phase: "media", done: 1, total: 2 },
      { phase: "media", done: 2, total: 2 },
    ]);
  });

  it("replaces media tag with a source link when the download returns an error status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<audio src="https://cdn.example/missing.mp3"></audio>' }],
      dir
    );

    // 404 is not retriable, so the request is made once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(media).toEqual([]);
    expect(chapters[0].contentHtml).toBe(
      '<p><a href="https://cdn.example/missing.mp3">Audio file</a>: https://cdn.example/missing.mp3</p>'
    );
  });

  it("falls back to the URL extension when the content-type is generic", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(Buffer.from("clip"), { headers: { "content-type": "application/octet-stream" } })
      )
    );

    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<video src="https://cdn.example/clip.MP4"></video>' }],
      dir
    );

    expect(media).toHaveLength(1);
    expect(media[0].href).toBe("media/0.mp4");
    expect(media[0].mediaType).toBe("video/mp4");
    expect(chapters[0].contentHtml).toBe(
      '<video controls src="media/0.mp4"><a href="https://cdn.example/clip.MP4">Video file</a></video>'
    );
  });

  it("replaces media tag with a source link when no extension can be resolved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(Buffer.from("stream"), { headers: { "content-type": "application/octet-stream" } })
      )
    );

    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<video src="https://cdn.example/stream"></video>' }],
      dir
    );

    expect(media).toEqual([]);
    expect(chapters[0].contentHtml).toBe(
      '<p><a href="https://cdn.example/stream">Video file</a>: https://cdn.example/stream</p>'
    );
  });

  it("rejects media whose declared content-length exceeds the 50MB cap without reading the body", async () => {
    // MAX_MEDIA_BYTES = 50 * 1024 * 1024 (src/services/epubBuilder.ts:180).
    const res = new Response(Buffer.from("tiny"), {
      headers: { "content-type": "audio/mpeg", "content-length": String(50 * 1024 * 1024 + 1) },
    });
    const getReader = vi.spyOn(ReadableStream.prototype, "getReader");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<audio src="https://cdn.example/big.mp3"></audio>' }],
      dir
    );

    expect(getReader).not.toHaveBeenCalled();
    expect(media).toEqual([]);
    expect(chapters[0].contentHtml).toBe(
      '<p><a href="https://cdn.example/big.mp3">Audio file</a>: https://cdn.example/big.mp3</p>'
    );
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("accepts a declared content-length exactly at the 50MB cap (strict > check)", async () => {
    const res = new Response(Buffer.from("small"), {
      headers: { "content-type": "audio/mpeg", "content-length": String(50 * 1024 * 1024) },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    const { media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<audio src="https://cdn.example/at-cap.mp3"></audio>' }],
      dir
    );

    expect(media).toHaveLength(1);
    expect(fs.readFileSync(media[0].filePath).toString()).toBe("small");
  });

  it("accepts a media stream exactly at the 50MB byte cap", async () => {
    const max = 50 * 1024 * 1024;
    const chunk = new Uint8Array(max);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(chunk);
              controller.close();
            },
          }),
          { headers: { "content-type": "audio/mpeg" } }
        )
      )
    );

    const { media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<audio src="https://cdn.example/at-cap.mp3"></audio>' }],
      dir
    );

    expect(media).toHaveLength(1);
    expect(fs.statSync(media[0].filePath).size).toBe(max);
  });

  it("replaces media tag with a source link when the response has no body stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { headers: { "content-type": "audio/mpeg" } }))
    );

    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<audio src="https://cdn.example/a.mp3"></audio>' }],
      dir
    );

    expect(media).toEqual([]);
    expect(chapters[0].contentHtml).toBe(
      '<p><a href="https://cdn.example/a.mp3">Audio file</a>: https://cdn.example/a.mp3</p>'
    );
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("removes media tag for an unknown data URI media type", async () => {
    const uri = `data:audio/x-unknown;base64,${Buffer.from("x").toString("base64")}`;
    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: `<audio src="${uri}"></audio>` }],
      dir
    );
    expect(media).toEqual([]);
    expect(chapters[0].contentHtml).toBe("");
  });

  it("removes media tag for a zero-byte data URI", async () => {
    // base64 of whitespace decodes to zero bytes; DATA_URI_MEDIA_RE needs at least one char.
    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<audio src="data:audio/mpeg;base64, "></audio>' }],
      dir
    );
    expect(media).toEqual([]);
    expect(chapters[0].contentHtml).toBe("");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("escapes & and quotes in the fallback source link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const src = 'https://cdn.example/a?b=1&c="q".mp3';

    const { chapters } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: `<audio src='${src}'></audio>` }],
      dir
    );

    expect(chapters[0].contentHtml).toBe(
      '<p><a href="https://cdn.example/a?b=1&amp;c=&quot;q&quot;.mp3">Audio file</a>: ' +
        'https://cdn.example/a?b=1&amp;c=&quot;q&quot;.mp3</p>'
    );
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
    const xhtml = Buffer.from(entries["OEBPS/0_c1.xhtml"]).toString();
    expect(xhtml).toContain('<audio controls="controls" src="media/0.mp3">');
    // Strict XML, the way Apple Books parses a chapter: a bare `controls` would throw here.
    expect(() => new JSDOM(xhtml, { contentType: "application/xhtml+xml" })).not.toThrow();
  });

  it("keeps mimetype as first entry and uncompressed", async () => {
    const filePath = path.join(dir, "media-0.mp3");
    fs.writeFileSync(filePath, "bytes");
    const out = await packMedia(fakeEpub("<body><audio src=\"media/0.mp3\"></audio></body>"), [
      { href: "media/0.mp3", mediaType: "audio/mpeg", filePath },
    ]);
    // Robust checks against the zip's own headers instead of fixed byte offsets.
    expect(Object.keys(unzipSync(out))[0]).toBe("mimetype");
    expect(localHeaderMethod(out, "mimetype")).toBe(0);
  });

  it("turns an existing bare controls into controls=\"controls\" without duplicating it", async () => {
    const filePath = path.join(dir, "media-0.mp3");
    fs.writeFileSync(filePath, "bytes");
    const out = await packMedia(fakeEpub('<body><audio controls src="media/0.mp3" controls="">A</audio></body>'), [
      { href: "media/0.mp3", mediaType: "audio/mpeg", filePath },
    ]);
    const xhtml = Buffer.from(unzipSync(out)["OEBPS/0_c1.xhtml"]).toString();
    expect(xhtml).toBe('<body><audio controls="controls" src="media/0.mp3">A</audio></body>');
    expect(() => new JSDOM(xhtml, { contentType: "application/xhtml+xml" })).not.toThrow();
  });

  it("restores controls on video tags and declares every media item in the manifest", async () => {
    const audioPath = path.join(dir, "media-0.mp3");
    const videoPath = path.join(dir, "media-1.mp4");
    fs.writeFileSync(audioPath, "audio-bytes");
    fs.writeFileSync(videoPath, "video-bytes");

    const out = await packMedia(fakeEpub('<body><video src="media/1.mp4"></video></body>'), [
      { href: "media/0.mp3", mediaType: "audio/mpeg", filePath: audioPath },
      { href: "media/1.mp4", mediaType: "video/mp4", filePath: videoPath },
    ]);

    const entries = unzipSync(out);
    // Items joined with the "\n        " separator from packMedia (src/services/epubBuilder.ts:371).
    expect(Buffer.from(entries["OEBPS/content.opf"]).toString()).toContain(
      '<item id="media_0" href="media/0.mp3" media-type="audio/mpeg" />\n        ' +
        '<item id="media_1" href="media/1.mp4" media-type="video/mp4" />'
    );
    expect(Buffer.from(entries["OEBPS/media/0.mp3"]).toString()).toBe("audio-bytes");
    expect(Buffer.from(entries["OEBPS/media/1.mp4"]).toString()).toBe("video-bytes");
    expect(Buffer.from(entries["OEBPS/0_c1.xhtml"]).toString()).toContain('<video controls="controls" src="media/1.mp4">');
  });

  it("leaves xhtml without media tags untouched", async () => {
    const filePath = path.join(dir, "media-0.mp3");
    fs.writeFileSync(filePath, "bytes");
    const plain = "<body><p>no media here</p></body>";

    const out = await packMedia(fakeEpub(plain), [
      { href: "media/0.mp3", mediaType: "audio/mpeg", filePath },
    ]);

    expect(Buffer.from(unzipSync(out)["OEBPS/0_c1.xhtml"]).toString()).toBe(plain);
  });

  it("adds no manifest items or files when the media list is empty", async () => {
    const out = await packMedia(fakeEpub("<body><p>x</p></body>"), []);
    const entries = unzipSync(out);

    // packMedia still writes the (empty) item list + indentation before </manifest>.
    expect(Buffer.from(entries["OEBPS/content.opf"]).toString()).toBe(
      '<package><manifest><item id="css" href="style.css" media-type="text/css" />' +
        "    \n    " +
        "</manifest></package>"
    );
    expect(Buffer.from(entries["OEBPS/0_c1.xhtml"]).toString()).toBe("<body><p>x</p></body>");
    expect(Object.keys(entries)).toEqual(["mimetype", "OEBPS/content.opf", "OEBPS/0_c1.xhtml"]);
  });

  it("stores media entries uncompressed", async () => {
    const filePath = path.join(dir, "media-0.mp3");
    fs.writeFileSync(filePath, "bytes");
    const out = await packMedia(fakeEpub('<body><audio src="media/0.mp3"></audio></body>'), [
      { href: "media/0.mp3", mediaType: "audio/mpeg", filePath },
    ]);

    expect(localHeaderMethod(out, "OEBPS/media/0.mp3")).toBe(0);
    // Non-media entries stay deflated.
    expect(localHeaderMethod(out, "OEBPS/0_c1.xhtml")).toBe(8);
  });
});

describe("buildEpub", () => {
  const metadata = { title: "Truyện Thử", author: "Tác giả", language: "vi" };

  // Minimal EPUB matching epub-gen's layout, standing in for the file it would produce.
  function generatedEpub(): Buffer {
    return Buffer.from(
      zipSync({
        mimetype: [Buffer.from("application/epub+zip"), { level: 0 }],
        "OEBPS/content.opf": Buffer.from("<package><manifest></manifest></package>"),
        "OEBPS/0_c1.xhtml": Buffer.from('<body><audio src="media/0.mp3"></audio></body>'),
      })
    );
  }

  let sourceEpub: Buffer;

  beforeEach(() => {
    epubGen.instances.length = 0;
    sourceEpub = generatedEpub();
    epubGen.setBytes(sourceEpub);
  });

  it("throws when no chapter is included in the book", async () => {
    await expect(
      buildEpub(metadata, [{ title: "C1", includeInBook: false, contentHtml: "<p>x</p>" }])
    ).rejects.toThrow("No chapters selected for export");
    // Throws before epub-gen runs, so nothing was generated or left behind.
    expect(epubGen.instances).toEqual([]);
  });

  it("includes only chapters marked includeInBook and reports packaging progress", async () => {
    const progress: BuildProgress[] = [];
    const parts = await buildEpub(
      metadata,
      [
        { title: "Kept", includeInBook: true, contentHtml: "<p>a</p>" },
        { title: "Skipped", includeInBook: false, contentHtml: "<p>b</p>" },
      ],
      (p) => progress.push(p)
    );

    expect(parts).toEqual([{ buffer: expect.any(Buffer), index: 0, total: 1 }]);
    expect(parts[0].buffer.equals(sourceEpub)).toBe(true);
    const { options } = epubGen.instances[0];
    expect(options.title).toBe("Truyện Thử");
    expect((options.content as Array<{ title: string }>).map((c) => c.title)).toEqual(["Kept"]);
    expect(progress).toEqual([
      { phase: "packaging", done: 0, total: 1 },
      { phase: "packaging", done: 1, total: 1 },
    ]);
  });

  it("packages fetched media into the epub and cleans up temp files", async () => {
    const mp3 = `data:audio/mpeg;base64,${Buffer.from("mp3-bytes").toString("base64")}`;
    const mkdtemp = vi.spyOn(fs.promises, "mkdtemp");

    const parts = await buildEpub(metadata, [
      { title: "C1", includeInBook: true, contentHtml: `<audio src="${mp3}"></audio>` },
    ]);

    const imageDir = await (mkdtemp.mock.results[0].value as Promise<string>);
    expect(fs.existsSync(imageDir)).toBe(false);
    expect(fs.existsSync(epubGen.instances[0].outputPath)).toBe(false);
    expect(parts).toHaveLength(1);
    expect(Buffer.from(unzipSync(parts[0].buffer)["OEBPS/media/0.mp3"]).toString()).toBe("mp3-bytes");
  });

  it("splits chapters into multiple parts once combined size passes maxBytes", async () => {
    const chapters = [
      { title: "C1", includeInBook: true, contentHtml: `<p>${"a".repeat(50)}</p>` },
      { title: "C2", includeInBook: true, contentHtml: `<p>${"a".repeat(50)}</p>` },
      { title: "C3", includeInBook: true, contentHtml: `<p>${"a".repeat(50)}</p>` },
    ];

    // Each chapter alone is ~60 bytes; any two together exceed a 60-byte cap, so this
    // forces one chapter per part.
    const parts = await buildEpub(metadata, chapters, undefined, 60);

    expect(parts.map((p) => [p.index, p.total])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    expect(epubGen.instances).toHaveLength(3);
    expect(epubGen.instances.map((inst) => (inst.options.content as Array<{ title: string }>).map((c) => c.title))).toEqual([
      ["C1"],
      ["C2"],
      ["C3"],
    ]);
  });

  it("only bundles media referenced within each split part", async () => {
    const audio1 = `data:audio/mpeg;base64,${Buffer.from("one").toString("base64")}`;
    const audio2 = `data:audio/mpeg;base64,${Buffer.from("two").toString("base64")}`;
    const chapters = [
      { title: "C1", includeInBook: true, contentHtml: `<p>${"a".repeat(50)}</p><audio src="${audio1}"></audio>` },
      { title: "C2", includeInBook: true, contentHtml: `<p>${"a".repeat(50)}</p><audio src="${audio2}"></audio>` },
    ];

    const parts = await buildEpub(metadata, chapters, undefined, 60);
    expect(parts).toHaveLength(2);

    const part1 = unzipSync(parts[0].buffer);
    const part2 = unzipSync(parts[1].buffer);
    expect(Object.keys(part1)).toContain("OEBPS/media/0.mp3");
    expect(Object.keys(part1)).not.toContain("OEBPS/media/1.mp3");
    expect(Object.keys(part2)).toContain("OEBPS/media/1.mp3");
    expect(Object.keys(part2)).not.toContain("OEBPS/media/0.mp3");
  });
});
