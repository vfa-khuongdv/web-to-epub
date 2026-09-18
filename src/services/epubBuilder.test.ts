import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentDisposition, embedImages, epubFileName } from "./epubBuilder";

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
