import Epub = require("epub-gen");
import { randomUUID } from "crypto";
import { unzipSync, zipSync } from "fflate";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { BookMetadata, ExportChapter } from "../types";
import { EXTENSION_BY_TYPE, sniffImageExtension } from "./coverStore";
import { fetchWithRetry } from "./toc/http";

// Simple, Kindle-friendly reading styles: system-safe fonts, no fixed sizes
// or absolute positioning, so it reflows correctly on any device.
// `display: block` cho ảnh/media là bắt buộc, không phải trang trí: mỗi block
// ảnh là một thẻ <img> anh em liền kề, mà <img> mặc định là inline nên nhiều
// ảnh hẹp sẽ xếp ngang như chữ trong một dòng — trang nguồn xếp dọc thì sách
// cũng phải xếp dọc.
const KINDLE_CSS = `
body { font-family: serif; line-height: 1.5; }
h1, h2, h3 { font-family: sans-serif; }
img, audio, video { display: block; margin: 0.6em auto; max-width: 100%; }
img, video { height: auto; }
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

// Tải tuần tự làm truyện nhiều ảnh mất hàng phút (651 ảnh của một truyện ảnh
// Wattpad mất ~90 giây ngay trên mạng nhanh), mà giao diện thì không có gì để
// hiện trong lúc chờ. Tải song song nhưng có trần: bắn hàng trăm request cùng
// lúc vào CDN dễ ăn 429, rồi backoff của fetchWithRetry còn làm chậm hơn cũ.
const IMAGE_CONCURRENCY = 8;
// File media lớn hơn ảnh nhiều lần và được giữ nguyên trong RAM tới lúc ghi ra
// đĩa, nên trần thấp hơn để không phình bộ nhớ (3 × 50MB thay vì 8 × 50MB).
const MEDIA_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await fn(items[index], index);
      }
    })
  );
  return results;
}

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

export async function embedImages(
  chapters: ExportChapter[],
  dir: string,
  onProgress?: OnBuildProgress
): Promise<ExportChapter[]> {
  const sources = new Set<string>();
  for (const chapter of chapters) {
    for (const tag of chapter.contentHtml.match(IMG_TAG_RE) ?? []) {
      const src = srcOf(tag);
      if (src) sources.add(src);
    }
  }
  if (sources.size === 0) return chapters;

  const list = [...sources];
  let done = 0;
  const saved = await mapWithConcurrency(list, IMAGE_CONCURRENCY, async (src, index) => {
    const filePath = await saveImage(src, dir, index);
    onProgress?.({ phase: "images", done: ++done, total: list.length });
    return filePath;
  });
  const localBySource = new Map<string, string>();
  list.forEach((src, index) => {
    const filePath = saved[index];
    if (filePath) localBySource.set(src, filePath);
  });

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

// Audio/video trong chương: epub-gen không biết gì về chúng — nó chỉ tải và
// đóng gói thẻ <img>, còn thuộc tính `controls` thì bị bộ lọc thuộc tính của nó
// xoá (không nằm trong allowlist), làm thẻ media mất nút play. Nên ở đây tự tải
// file về, trỏ src vào đường dẫn trong sách, rồi sau khi epub-gen đóng gói xong
// thì mở file EPUB ra vá lại: thêm file media, khai báo trong manifest và trả
// `controls` về chỗ cũ (xem packMedia).
//
// Lưu ý về trình đọc: audio/mpeg và audio/mp4 là core media type của EPUB3 nên
// phát được ở mọi trình đọc theo chuẩn (Apple Books, Thorium, Calibre). Video
// thì không phải core media type — vẫn phát tốt ở các trình đọc trên nhưng
// epubcheck sẽ báo cảnh báo. Kindle không phát cả hai: ở đó người đọc thấy phần
// dự phòng bên trong thẻ — link về nguồn khi nguồn là URL mở được, nếu không
// thì chỉ còn nhãn "Tệp âm thanh"/"Tệp video".
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
// File media lớn hơn ảnh rất nhiều nên 15s mặc định của fetchWithRetry không đủ.
const MEDIA_TIMEOUT_MS = 120_000;

const MEDIA_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
};

// Nhiều đuôi cùng một media type (m4a/mp4, ogg/oga/opus) — giữ đuôi đầu tiên,
// đuôi nào cũng được miễn media type khai trong manifest đúng.
const MEDIA_EXTENSION_BY_TYPE = new Map(
  Object.entries(MEDIA_TYPES)
    .reverse()
    .map(([extension, type]) => [type, extension])
);

const MEDIA_TAG_RE = /<(audio|video)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
const DATA_URI_MEDIA_RE = /^data:((?:audio|video)\/[a-z0-9.+-]+);base64,([\s\S]+)$/i;

// Dựng EPUB cho truyện nhiều ảnh mất hàng chục giây, phần lớn là tải ảnh về.
// Không báo gì ra ngoài thì người dùng chỉ thấy nút "Đang xuất…" đứng im và
// tưởng app treo.
export interface BuildProgress {
  phase: "images" | "media" | "packaging";
  done: number;
  total: number;
}

export type OnBuildProgress = (progress: BuildProgress) => void;

export interface EpubMedia {
  href: string; // đường dẫn trong EPUB, tương đối với OEBPS/
  mediaType: string;
  filePath: string; // file tạm trên đĩa, đọc lúc đóng gói
}

// Khác ảnh: các host media đặt content-type đúng (phải đúng thì trình duyệt mới
// phát được), nên tin content-type trước, chỉ đoán theo đuôi URL khi header là
// kiểu chung chung như application/octet-stream.
function mediaExtension(src: string, contentType: string): string | undefined {
  const fromType = MEDIA_EXTENSION_BY_TYPE.get(contentType);
  if (fromType) return fromType;
  let pathname: string;
  try {
    pathname = new URL(src).pathname;
  } catch {
    return undefined;
  }
  const extension = pathname.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  return extension && MEDIA_TYPES[extension] ? extension : undefined;
}

// content-length là tự khai và rất hay thiếu ở host media; đọc theo luồng và
// dừng ngay khi vượt ngưỡng để một URL trỏ nhầm vào file nhiều GB không nuốt
// sạch RAM trước khi kịp kiểm tra dung lượng.
async function readCapped(res: Response, maxBytes: number): Promise<Buffer | undefined> {
  const reader = res.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function saveMedia(src: string, dir: string, index: number): Promise<EpubMedia | undefined> {
  let bytes: Buffer;
  let extension: string | undefined;

  const dataUri = src.match(DATA_URI_MEDIA_RE);
  if (dataUri) {
    bytes = Buffer.from(dataUri[2], "base64");
    extension = MEDIA_EXTENSION_BY_TYPE.get(dataUri[1].toLowerCase());
  } else if (/^https?:/i.test(src)) {
    try {
      const res = await fetchWithRetry(
        src,
        { headers: { "User-Agent": IMAGE_USER_AGENT, Accept: "audio/*,video/*,*/*" } },
        { maxAttempts: 2, timeoutMs: MEDIA_TIMEOUT_MS }
      );
      if (!res.ok) return undefined;
      const declaredLength = Number(res.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_BYTES) return undefined;
      const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      extension = mediaExtension(src, contentType);
      if (!extension) return undefined;
      const capped = await readCapped(res, MAX_MEDIA_BYTES);
      if (!capped) return undefined;
      bytes = capped;
    } catch {
      return undefined;
    }
  } else {
    return undefined;
  }

  if (!extension || bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) return undefined;
  const filePath = path.join(dir, `media-${index}.${extension}`);
  await fs.writeFile(filePath, bytes);
  return { href: `media/${index}.${extension}`, mediaType: MEDIA_TYPES[extension], filePath };
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mediaLabel(name: string): string {
  return name.toLowerCase() === "audio" ? "Tệp âm thanh" : "Tệp video";
}

/**
 * Đổi mọi thẻ <audio>/<video> trong chương thành thẻ trỏ vào file đã tải về, và
 * trả kèm danh sách file để packMedia nhét vào EPUB. Thẻ nào không tải được
 * (link streaming, host chặn, quá dung lượng) thành một đoạn chứa link về nguồn
 * — mất hẳn thẻ như với ảnh hỏng thì người đọc không biết là đã có gì ở đó.
 */
export async function embedMedia(
  chapters: ExportChapter[],
  dir: string,
  onProgress?: OnBuildProgress
): Promise<{ chapters: ExportChapter[]; media: EpubMedia[] }> {
  const sources = new Set<string>();
  for (const chapter of chapters) {
    for (const [, , attrs] of chapter.contentHtml.matchAll(MEDIA_TAG_RE)) {
      const src = srcOf(`<x${attrs}>`);
      if (src) sources.add(src);
    }
  }
  if (sources.size === 0) return { chapters, media: [] };

  const list = [...sources];
  let done = 0;
  const saved = await mapWithConcurrency(list, MEDIA_CONCURRENCY, async (src, index) => {
    const file = await saveMedia(src, dir, index);
    onProgress?.({ phase: "media", done: ++done, total: list.length });
    return file;
  });
  const bySource = new Map<string, EpubMedia>();
  list.forEach((src, index) => {
    if (saved[index]) bySource.set(src, saved[index]!);
  });
  const media = saved.filter((m): m is EpubMedia => m !== undefined);

  const withMedia = chapters.map((chapter) => ({
    ...chapter,
    contentHtml: chapter.contentHtml.replace(MEDIA_TAG_RE, (tag, name: string, attrs: string) => {
      const src = srcOf(`<x${attrs}>`);
      if (!src) return "";
      const label = mediaLabel(name);
      // Chỉ link về nguồn khi nguồn là URL mở được; data URI thì link vô nghĩa
      // mà lại kéo cả khối base64 vào sách.
      const link = /^https?:/i.test(src) ? `<a href="${escapeAttribute(src)}">${label}</a>` : label;
      const saved = bySource.get(src);
      if (!saved) return /^https?:/i.test(src) ? `<p>${link}: ${escapeAttribute(src)}</p>` : "";
      // `controls` được trả lại sau khi epub-gen chạy xong; giữ ở đây cho đúng
      // ý định và để thẻ vẫn dùng được nếu về sau bỏ epub-gen.
      return `<${name} controls src="${saved.href}">${link}</${name}>`;
    }),
  }));

  return { chapters: withMedia, media };
}

/**
 * Vá file EPUB do epub-gen tạo ra: thêm file media vào OEBPS/media/, khai báo
 * trong manifest và trả thuộc tính `controls` mà bộ lọc của epub-gen đã xoá.
 * Phải giải nén rồi nén lại vì epub-gen chỉ trả về file zip đã đóng.
 */
export async function packMedia(epubBytes: Buffer, media: EpubMedia[]): Promise<Buffer> {
  const entries = unzipSync(epubBytes);

  const opfPath = "OEBPS/content.opf";
  const opf = Buffer.from(entries[opfPath]).toString("utf8");
  const items = media
    .map((m, i) => `<item id="media_${i}" href="${m.href}" media-type="${m.mediaType}" />`)
    .join("\n        ");
  entries[opfPath] = Buffer.from(opf.replace("</manifest>", `    ${items}\n    </manifest>`), "utf8");

  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.endsWith(".xhtml")) continue;
    const html = Buffer.from(bytes).toString("utf8");
    if (!/<(?:audio|video)\b/i.test(html)) continue;
    entries[name] = Buffer.from(html.replace(/<(audio|video)\b/gi, "<$1 controls"), "utf8");
  }

  for (const m of media) {
    entries[`OEBPS/${m.href}`] = await fs.readFile(m.filePath);
  }

  // OCF bắt buộc "mimetype" là entry đầu tiên và không nén; media thì nén cũng
  // không nhỏ đi được (đã là định dạng nén) nên lưu thẳng cho nhanh.
  const stored = new Set(["mimetype", ...media.map((m) => `OEBPS/${m.href}`)]);
  const zippable: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const name of ["mimetype", ...Object.keys(entries).filter((n) => n !== "mimetype")]) {
    zippable[name] = [entries[name], { level: stored.has(name) ? 0 : 6 }];
  }
  return Buffer.from(zipSync(zippable));
}

export async function buildEpub(
  metadata: BookMetadata,
  chapters: ExportChapter[],
  onProgress?: OnBuildProgress
): Promise<Buffer> {
  const included = chapters.filter((c) => c.includeInBook);
  if (included.length === 0) {
    throw new Error("Không có chapter nào được chọn để export");
  }

  const outputPath = path.join(os.tmpdir(), `epub-${randomUUID()}.epub`);
  const imageDir = await fs.mkdtemp(path.join(os.tmpdir(), "epub-img-"));
  const withImages = await embedImages(included, imageDir, onProgress);
  const { chapters: withMedia, media } = await embedMedia(withImages, imageDir, onProgress);
  // Đóng gói không chia nhỏ được (epub-gen chạy một mạch) nên chỉ báo vào/ra.
  onProgress?.({ phase: "packaging", done: 0, total: 1 });

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
      content: withMedia.map((c) => ({ title: c.title, data: c.contentHtml })),
    },
    outputPath
  );

  await epub.promise;

  try {
    const bytes = await fs.readFile(outputPath);
    const result = media.length > 0 ? await packMedia(bytes, media) : bytes;
    onProgress?.({ phase: "packaging", done: 1, total: 1 });
    return result;
  } finally {
    await fs.unlink(outputPath).catch(() => {});
    await fs.rm(imageDir, { recursive: true, force: true }).catch(() => {});
  }
}
