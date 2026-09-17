import { describe, expect, it } from "vitest";
import { contentDisposition, epubFileName } from "./epubBuilder";

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
