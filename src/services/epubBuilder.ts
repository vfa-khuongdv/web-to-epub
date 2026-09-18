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
// `display: block` for images/media is mandatory, not decoration: each image block is an <img> tag
// next to its siblings, but <img> defaults to inline, so many narrow images would flow horizontally
// like text in a line — if the source page stacks them vertically, the book must too.
const KINDLE_CSS = `
body { font-family: serif; line-height: 1.5; }
h1, h2, h3 { font-family: sans-serif; }
img, audio, video { display: block; margin: 0.6em auto; max-width: 100%; }
img, video { height: auto; }
`;

// Downloaded EPUB filename: preserve Vietnamese diacritics (users must be able to read
// the story name) — only replace invalid filename characters and control characters,
// collapse whitespace, then trim to not exceed the filesystem's filename length limit.
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

// RFC 6266: ASCII fallback for old clients, plus UTF-8 percent-encoded version
// so the filename preserves Vietnamese diacritics when downloading directly from the API.
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// Images in chapters: epub-gen fetches http URLs in <img> itself, but it guesses the file extension
// from the URL (`mime.getType(url)`), so URLs without extensions — very common with image CDNs —
// produce "<id>.null" and empty manifest media-type; and when fetching fails, it still writes <img>
// pointing to a nonexistent file, breaking the EPUB. So fetch them first, identify the extension
// via magic bytes like coverStore does, then give epub-gen a file:// path guaranteed to exist;
// failed images are removed from the <img> tag entirely instead of leaving a broken link.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTR_RE = /\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i;
const DATA_URI_RE = /^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i;

// Sequential download makes image-heavy stories take minutes (651 images from a Wattpad image story
// take ~90 seconds even on fast networks), and the UI has nothing to show while waiting. Parallel download
// with a limit: firing hundreds of requests at a CDN at once risks 429s, and fetchWithRetry's backoff
// makes it even slower than before.
const IMAGE_CONCURRENCY = 8;
// Media files are much larger than images and held in RAM until write, so lower the limit to avoid
// memory bloat (3 × 50MB instead of 8 × 50MB).
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

// Audio/video in chapters: epub-gen doesn't know about them — it only fetches and packages
// <img> tags; the `controls` attribute gets stripped by its allowlist filter, leaving media tags
// with no play button. So we fetch the files ourselves, point src to paths within the book, and
// after epub-gen finishes, unzip the EPUB and patch it: add media files, declare them in the manifest,
// and restore `controls` (see packMedia).
//
// Reader note: audio/mpeg and audio/mp4 are EPUB3 core media types, so they play on all standard
// readers (Apple Books, Thorium, Calibre). Video isn't a core type — still plays fine on those readers
// but epubcheck will warn. Kindle plays neither: readers see the fallback content inside the tag —
// a link to the source if the source is an openable URL, otherwise just the label "Audio file"/"Video file".
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
// Media files are far larger than images, so fetchWithRetry's 15s default isn't enough.
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

// Multiple extensions for the same media type (m4a/mp4, ogg/oga/opus) — keep the first one;
// any extension works as long as the media type is declared correctly in the manifest.
const MEDIA_EXTENSION_BY_TYPE = new Map(
  Object.entries(MEDIA_TYPES)
    .reverse()
    .map(([extension, type]) => [type, extension])
);

const MEDIA_TAG_RE = /<(audio|video)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
const DATA_URI_MEDIA_RE = /^data:((?:audio|video)\/[a-z0-9.+-]+);base64,([\s\S]+)$/i;

// Building an EPUB for multi-image stories takes tens of seconds, mostly fetching images.
// Silence would leave the user staring at a frozen "Exporting..." button, thinking the app hung.
export interface BuildProgress {
  phase: "images" | "media" | "packaging";
  done: number;
  total: number;
}

export type OnBuildProgress = (progress: BuildProgress) => void;

export interface EpubMedia {
  href: string; // path within EPUB, relative to OEBPS/
  mediaType: string;
  filePath: string; // temp file on disk, read during packaging
}

// Unlike images: media hosts typically set the content-type correctly (it must be right for browsers
// to play it), so trust content-type first; only guess by URL extension when the header is generic
// like application/octet-stream.
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

// Content-length is self-reported and often missing from media hosts; read streams and
// stop immediately on exceeding the cap so a wrong URL pointing to a multi-GB file won't
// exhaust RAM before the size check kicks in.
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
  return name.toLowerCase() === "audio" ? "Audio file" : "Video file";
}

/**
 * Replace every <audio>/<video> tag in chapters with one pointing to a fetched file, and
 * return a list of files for packMedia to add to the EPUB. Tags that fail to fetch
 * (streaming link, blocked host, too large) become a paragraph with a source link —
 * complete loss like a broken image so readers know something was there.
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
      // Only link to the source if it's an openable URL; data URIs make pointless links
      // and would drag the whole base64 block into the book.
      const link = /^https?:/i.test(src) ? `<a href="${escapeAttribute(src)}">${label}</a>` : label;
      const saved = bySource.get(src);
      if (!saved) return /^https?:/i.test(src) ? `<p>${link}: ${escapeAttribute(src)}</p>` : "";
      // `controls` is restored after epub-gen finishes; keep it here for correctness
      // and so the tag still works if we drop epub-gen in the future.
      return `<${name} controls src="${saved.href}">${link}</${name}>`;
    }),
  }));

  return { chapters: withMedia, media };
}

/**
 * Patch the EPUB file created by epub-gen: add media files to OEBPS/media/, declare them
 * in the manifest, and restore the `controls` attribute that epub-gen's filter stripped.
 * Must unzip then rezip because epub-gen only returns a closed zip file.
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

  // OCF requires "mimetype" to be the first entry and uncompressed; media won't shrink even
  // if compressed (already a compressed format) so store them uncompressed for speed.
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
    throw new Error("No chapters selected for export");
  }

  const outputPath = path.join(os.tmpdir(), `epub-${randomUUID()}.epub`);
  const imageDir = await fs.mkdtemp(path.join(os.tmpdir(), "epub-img-"));
  const withImages = await embedImages(included, imageDir, onProgress);
  const { chapters: withMedia, media } = await embedMedia(withImages, imageDir, onProgress);
  // Packaging cannot be split (epub-gen runs in one pass), so only report start/end.
  onProgress?.({ phase: "packaging", done: 0, total: 1 });

  const epub = new Epub(
    {
      title: metadata.title || "Untitled Book",
      author: metadata.author || "Unknown",
      lang: metadata.language || "en",
      cover: metadata.coverUrl || undefined,
      tocTitle: "Table of Contents",
      // By default epub-gen extracts to node_modules/epub-gen/tempDir — in Docker images,
      // only root can write there (app runs as the `node` user).
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
