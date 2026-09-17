import Epub = require("epub-gen");
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { BookMetadata, ExportChapter } from "../types";

// Simple, Kindle-friendly reading styles: system-safe fonts, no fixed sizes
// or absolute positioning, so it reflows correctly on any device.
const KINDLE_CSS = `
body { font-family: serif; line-height: 1.5; }
h1, h2, h3 { font-family: sans-serif; }
img { max-width: 100%; height: auto; }
`;

// Tên file EPUB tải về: giữ nguyên tiếng Việt có dấu (người dùng phải đọc được
// tên truyện) — chỉ thay ký tự không hợp lệ trong tên file và ký tự điều khiển,
// gộp khoảng trắng, rồi cắt bớt để không vượt giới hạn tên file của hệ điều hành.
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_FILENAME_LENGTH = 120;

export function epubFileName(title: string): string {
  const base = title
    .replace(ILLEGAL_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
    .trim();
  return `${base || "book"}.epub`;
}

// RFC 6266: bản ASCII dự phòng cho client cũ, kèm bản UTF-8 percent-encoded để
// tên file giữ đúng tiếng Việt khi tải trực tiếp từ API.
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function buildEpub(metadata: BookMetadata, chapters: ExportChapter[]): Promise<Buffer> {
  const included = chapters.filter((c) => c.includeInBook);
  if (included.length === 0) {
    throw new Error("Không có chapter nào được chọn để export");
  }

  const outputPath = path.join(os.tmpdir(), `epub-${randomUUID()}.epub`);

  const epub = new Epub(
    {
      title: metadata.title || "Untitled Book",
      author: metadata.author || "Unknown",
      lang: metadata.language || "en",
      cover: metadata.coverUrl || undefined,
      tocTitle: "Mục lục",
      // Mặc định epub-gen giải nén vào node_modules/epub-gen/tempDir — thư mục
      // này chỉ root ghi được trong ảnh Docker (app chạy bằng user `node`).
      tempDir: os.tmpdir(),
      css: KINDLE_CSS,
      content: included.map((c) => ({ title: c.title, data: c.contentHtml })),
    },
    outputPath
  );

  await epub.promise;

  try {
    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(outputPath).catch(() => {});
  }
}
