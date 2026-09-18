import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import { contentDisposition, embedImages, embedMedia, epubFileName, packMedia } from "./epubBuilder";

describe("epubFileName", () => {
  it("giữ nguyên tiếng Việt có dấu", () => {
    expect(epubFileName("Nữ Học Bá Trùng Sinh Thành Nữ Phụ Ở Cổ Đại")).toBe(
      "Nữ Học Bá Trùng Sinh Thành Nữ Phụ Ở Cổ Đại.epub"
    );
  });

  it("thay ký tự không hợp lệ trong tên file bằng khoảng trắng", () => {
    expect(epubFileName('Truyện: "A/B" <1> | 2?')).toBe("Truyện A B 1 2.epub");
  });

  it("gộp khoảng trắng thừa và cắt hai đầu", () => {
    expect(epubFileName("  Hãn   Phu  ")).toBe("Hãn Phu.epub");
  });

  it("dùng tên mặc định khi tên rỗng", () => {
    expect(epubFileName("   ")).toBe("book.epub");
  });

  it("cắt bớt tên quá dài để không vượt giới hạn tên file", () => {
    const name = epubFileName("a".repeat(300));
    expect(name.length).toBeLessThanOrEqual(125);
    expect(name.endsWith(".epub")).toBe(true);
  });
});

describe("contentDisposition", () => {
  it("kèm bản ASCII dự phòng và bản UTF-8 percent-encoded", () => {
    expect(contentDisposition("Nữ Học Bá.epub")).toBe(
      "attachment; filename=\"N_ H_c B_.epub\"; filename*=UTF-8''N%E1%BB%AF%20H%E1%BB%8Dc%20B%C3%A1.epub"
    );
  });

  it("không để ký tự đặc biệt phá vỡ header", () => {
    const value = contentDisposition(epubFileName('Truyện "A" (b)'));
    expect(value).toContain("filename*=UTF-8''");
    expect(value).toContain('filename="Truy_n A (b).epub"');
    expect(value).not.toContain("\n");
  });
});

describe("embedImages", () => {
  // PNG 1x1 hợp lệ, đủ magic bytes để nhận ra là ảnh.
  const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "embed-images-test-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("để nguyên chapter không có ảnh", async () => {
    const chapters = [{ title: "C1", includeInBook: true, contentHtml: "<p>chữ</p>" }];
    expect(await embedImages(chapters, dir)).toEqual(chapters);
  });

  it("lưu ảnh data URI ra file và trỏ src vào file đó", async () => {
    const [chapter] = await embedImages(
      [{ title: "C1", includeInBook: true, contentHtml: `<img src="data:image/png;base64,${PNG_BASE64}" alt="a"/>` }],
      dir
    );
    const src = chapter.contentHtml.match(/src="file:\/\/([^"]+)"/)?.[1];
    expect(src).toBeDefined();
    // Đuôi file lấy từ magic bytes, không phải từ URL.
    expect(src!.endsWith(".png")).toBe(true);
    expect(fs.existsSync(src!)).toBe(true);
    expect(chapter.contentHtml).toContain('alt="a"');
  });

  it("bỏ hẳn thẻ img khi không nhận ra ảnh, giữ nguyên phần chữ", async () => {
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
    // Thà mất ảnh còn hơn để EPUB trỏ tới file không tồn tại.
    expect(chapter.contentHtml).toBe("<p>trước</p><p>sau</p>");
  });

  it("bỏ thẻ img có src không phải http hay data URI", async () => {
    const [chapter] = await embedImages(
      [{ title: "C1", includeInBook: true, contentHtml: '<p>x</p><img src="/local/a.jpg" />' }],
      dir
    );
    expect(chapter.contentHtml).toBe("<p>x</p>");
  });

  it("tải một lần cho nhiều thẻ dùng chung một ảnh", async () => {
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

  it("để nguyên chapter không có thẻ media", async () => {
    const chapters = [{ title: "C1", includeInBook: true, contentHtml: "<p>x</p>" }];
    const result = await embedMedia(chapters, dir);
    expect(result.chapters).toBe(chapters);
    expect(result.media).toEqual([]);
  });

  it("lưu file media ra đĩa và trỏ src vào đường dẫn trong sách", async () => {
    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: `<audio controls src="${MP3_DATA_URI}">x</audio>` }],
      dir
    );
    expect(media).toHaveLength(1);
    expect(media[0].href).toBe("media/0.mp3");
    expect(media[0].mediaType).toBe("audio/mpeg");
    expect(fs.readFileSync(media[0].filePath).toString()).toBe("fake-mp3");
    expect(chapters[0].contentHtml).toBe('<audio controls src="media/0.mp3">Tệp âm thanh</audio>');
  });

  it("đổi thẻ không tải được thành link về nguồn thay vì bỏ hẳn", async () => {
    const { chapters, media } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<p>a</p><audio src="https://x.invalid/s.m3u8"></audio>' }],
      dir
    );
    expect(media).toEqual([]);
    expect(chapters[0].contentHtml).toBe(
      '<p>a</p><p><a href="https://x.invalid/s.m3u8">Tệp âm thanh</a>: https://x.invalid/s.m3u8</p>'
    );
  });

  it("bỏ thẻ media có src không phải http hay data URI", async () => {
    const { chapters } = await embedMedia(
      [{ title: "C1", includeInBook: true, contentHtml: '<p>a</p><video src="/local/a.mp4"></video>' }],
      dir
    );
    expect(chapters[0].contentHtml).toBe("<p>a</p>");
  });

  it("bỏ file vượt ngưỡng dung lượng dù server không khai content-length", async () => {
    // Chunk 1MB: readCapped dừng ngay khi vượt ngưỡng nên chỉ đọc ~51 chunk.
    // Chia nhỏ hơn (65536 chunk 1KB) thì chỉ riêng việc nạp vào stream đã lâu
    // hơn cả timeout của test.
    const chunk = new Uint8Array(1024 * 1024);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            // Nguồn không bao giờ hết và không khai content-length — chỉ ngưỡng
            // dung lượng mới cắt được nó.
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

  it("tải một lần cho nhiều thẻ dùng chung một file", async () => {
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

  // EPUB tối giản đúng cấu trúc epub-gen sinh ra, đủ để kiểm tra phần vá.
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

  it("thêm file media, khai báo manifest và trả lại controls", async () => {
    const filePath = path.join(dir, "media-0.mp3");
    fs.writeFileSync(filePath, "bytes");
    const out = await packMedia(fakeEpub('<body><audio src="media/0.mp3">Tệp âm thanh</audio></body>'), [
      { href: "media/0.mp3", mediaType: "audio/mpeg", filePath },
    ]);

    const entries = unzipSync(out);
    expect(Buffer.from(entries["OEBPS/media/0.mp3"]).toString()).toBe("bytes");
    expect(Buffer.from(entries["OEBPS/content.opf"]).toString()).toContain(
      '<item id="media_0" href="media/0.mp3" media-type="audio/mpeg" />'
    );
    expect(Buffer.from(entries["OEBPS/0_c1.xhtml"]).toString()).toContain('<audio controls src="media/0.mp3">');
  });

  it("giữ mimetype là entry đầu tiên và không nén", async () => {
    const filePath = path.join(dir, "media-0.mp3");
    fs.writeFileSync(filePath, "bytes");
    const out = await packMedia(fakeEpub("<body><audio src=\"media/0.mp3\"></audio></body>"), [
      { href: "media/0.mp3", mediaType: "audio/mpeg", filePath },
    ]);
    // Entry đầu tiên lưu nguyên văn: chuỗi mimetype nằm ngay đầu file zip.
    expect(out.subarray(30, 38).toString()).toBe("mimetype");
    expect(out.subarray(38, 58).toString()).toBe("application/epub+zip");
  });
});
