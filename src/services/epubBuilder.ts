import Epub = require("epub-gen");
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { BookMetadata, ExportChapter } from "../types";
import { EXTENSION_BY_TYPE, sniffImageExtension } from "./coverStore";
import { fetchWithRetry } from "./toc/http";

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

// Ảnh trong chương: epub-gen tự tải URL http trong <img>, nhưng nó đoán đuôi
// file từ URL (`mime.getType(url)`), nên URL không có đuôi — rất phổ biến với
// CDN ảnh — cho ra file "<id>.null" và manifest media-type rỗng; còn khi tải
// hỏng thì nó vẫn ghi <img> trỏ tới file không tồn tại, làm EPUB sai chuẩn.
// Nên ở đây tự tải trước, nhận đuôi bằng magic bytes như coverStore, rồi đưa
// cho epub-gen đường dẫn file:// đã chắc chắn tồn tại; ảnh nào tải hỏng thì bỏ
// hẳn thẻ <img> thay vì để lại tham chiếu gãy.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTR_RE = /\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i;
const DATA_URI_RE = /^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i;

function srcOf(tag: string): string | undefined {
  const m = tag.match(SRC_ATTR_RE);
  return m ? (m[2] ?? m[3]) : undefined;
}

async function saveImage(src: string, dir: string, index: number): Promise<string | undefined> {
  let bytes: Buffer;
  let contentType = "";
  const dataUri = src.match(DATA_URI_RE);
  if (dataUri) {
    bytes = Buffer.from(dataUri[1], "base64");
  } else if (/^https?:/i.test(src)) {
    try {
      const res = await fetchWithRetry(
        src,
        { headers: { "User-Agent": IMAGE_USER_AGENT, Accept: "image/*" } },
        { maxAttempts: 2 }
      );
      if (!res.ok) return undefined;
      const declaredLength = Number(res.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) return undefined;
      bytes = Buffer.from(await res.arrayBuffer());
      contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    } catch {
      return undefined;
    }
  } else {
    return undefined;
  }

  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return undefined;
  const extension = sniffImageExtension(bytes) ?? EXTENSION_BY_TYPE.get(contentType);
  if (!extension) return undefined;
  const filePath = path.join(dir, `${index}.${extension}`);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

export async function embedImages(chapters: ExportChapter[], dir: string): Promise<ExportChapter[]> {
  const sources = new Set<string>();
  for (const chapter of chapters) {
    for (const tag of chapter.contentHtml.match(IMG_TAG_RE) ?? []) {
      const src = srcOf(tag);
      if (src) sources.add(src);
    }
  }
  if (sources.size === 0) return chapters;

  const localBySource = new Map<string, string>();
  let index = 0;
  for (const src of sources) {
    const filePath = await saveImage(src, dir, index++);
    if (filePath) localBySource.set(src, filePath);
  }

  return chapters.map((chapter) => ({
    ...chapter,
    contentHtml: chapter.contentHtml.replace(IMG_TAG_RE, (tag) => {
      const src = srcOf(tag);
      const filePath = src ? localBySource.get(src) : undefined;
      if (!filePath) return "";
      return tag.replace(SRC_ATTR_RE, ` src="file://${filePath}"`);
    }),
  }));
}

export async function buildEpub(metadata: BookMetadata, chapters: ExportChapter[]): Promise<Buffer> {
  const included = chapters.filter((c) => c.includeInBook);
  if (included.length === 0) {
    throw new Error("Không có chapter nào được chọn để export");
  }

  const outputPath = path.join(os.tmpdir(), `epub-${randomUUID()}.epub`);
  const imageDir = await fs.mkdtemp(path.join(os.tmpdir(), "epub-img-"));
  const withImages = await embedImages(included, imageDir);

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
      content: withImages.map((c) => ({ title: c.title, data: c.contentHtml })),
    },
    outputPath
  );

  await epub.promise;

  try {
    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(outputPath).catch(() => {});
    await fs.rm(imageDir, { recursive: true, force: true }).catch(() => {});
  }
}
