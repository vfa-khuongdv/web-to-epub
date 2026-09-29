import { t } from "./lang";

// An Internet Archive item whose catalog entry marks it lending/access-restricted is
// refused before any file is fetched. The app never borrows, signs in or decrypts.
export class ArchiveNotFoundError extends Error {
  constructor(id: string) {
    super(t("Internet Archive item not found: {id}", { id }));
  }
}

export class ArchiveNotBookError extends Error {
  constructor(url: string) {
    super(t("This Internet Archive item is not a book: {url}", { url }));
  }
}

export class ArchiveRestrictedError extends Error {
  constructor(url: string) {
    super(t("This Internet Archive item is access-restricted (borrow-only) and cannot be imported: {url}", { url }));
  }
}

export class ArchiveUnavailableError extends Error {
  constructor(url: string) {
    super(t("No readable EPUB, PDF, or text file is available for this Internet Archive item: {url}", { url }));
  }
}

export class ArchiveTooManyPagesError extends Error {
  constructor(count: number) {
    super(t("This Internet Archive book has too many pages to import (maximum {count})", { count }));
  }
}

export interface ArchiveFile {
  name: string;
  format?: string;
  source?: string;
  private?: string | boolean;
  size?: string;
}

export interface ArchiveItem {
  id: string;
  title: string;
  author?: string;
  language?: string;
  pdfDegraded: boolean;
  files: ArchiveFile[];
}

const ITEM_PATH_RE = /^\/(?:details|metadata|download)\/([^/?#]+)/;

// The item id from an archive.org URL: /details/<id> (book-reader deep links included),
// /metadata/<id>, /download/<id>/<file>. Any other path, or another host, is not ours.
export function archiveItemId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "archive.org") return undefined;
  const match = ITEM_PATH_RE.exec(parsed.pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function metaString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim() || undefined;
  return undefined;
}

// A network failure propagates as the raw fetch error (the route turns that into the
// generic message); an unknown id answers 404 or an empty body, both "not found".
export async function fetchItem(fetchImpl: typeof fetch, id: string): Promise<ArchiveItem> {
  const res = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  if (!res.ok) throw new ArchiveNotFoundError(id);
  const data = (await res.json().catch(() => null)) as
    | { metadata?: Record<string, unknown>; files?: unknown }
    | null;
  const metadata = data?.metadata;
  if (!metadata || metaString(metadata.identifier) !== id) throw new ArchiveNotFoundError(id);
  const url = `https://archive.org/details/${id}`;
  const mediatype = metaString(metadata.mediatype);
  if (mediatype && mediatype !== "texts") throw new ArchiveNotBookError(url);
  if (metadata["access-restricted-item"] === "true" || metadata["access-restricted-item"] === true) {
    throw new ArchiveRestrictedError(url);
  }
  return {
    id,
    title: metaString(metadata.title) ?? id,
    author: metaString(metadata.creator),
    language: metaString(metadata.language),
    pdfDegraded: !!metaString(metadata.pdf_degraded),
    files: Array.isArray(data.files) ? (data.files as ArchiveFile[]) : [],
  };
}

// A book file bigger than this is not read; the metadata's own `size` is checked first,
// the stream second, so a missing or wrong Content-Length cannot run away.
export const MAX_ARCHIVE_FILE_BYTES = 100 * 1024 * 1024;

function isPrivateFile(file: ArchiveFile): boolean {
  return file.private === "true" || file.private === true;
}

function sizeOf(file: ArchiveFile): number {
  const size = Number(file.size);
  return Number.isFinite(size) ? size : 0;
}

// LCP-wrapped EPUBs are the lending copies, never plain files.
const isEpubFile = (file: ArchiveFile): boolean => file.format === "EPUB" && !/_lcp\.epub$/i.test(file.name);
const isTextFile = (file: ArchiveFile): boolean => file.format === "DjVuTXT";
const isPdfFile = (file: ArchiveFile): boolean => /\.pdf$/i.test(file.name) && !/encrypted/i.test(file.format ?? "");
const epubRank = (file: ArchiveFile): number => (file.source === "original" ? 0 : 1);
const pdfRank = (file: ArchiveFile): number => (file.format === "Text PDF" ? 0 : 1);

function pickFile(
  files: ArchiveFile[],
  accept: (file: ArchiveFile) => boolean,
  rank: (file: ArchiveFile) => number,
  maxBytes: number
): ArchiveFile | undefined {
  return files
    .filter((file) => !isPrivateFile(file) && sizeOf(file) <= maxBytes && accept(file))
    .sort((a, b) => rank(a) - rank(b) || sizeOf(a) - sizeOf(b))[0];
}

export function pickEpubFile(files: ArchiveFile[], maxBytes = MAX_ARCHIVE_FILE_BYTES): ArchiveFile | undefined {
  return pickFile(files, isEpubFile, epubRank, maxBytes);
}

export function pickTextFile(files: ArchiveFile[], maxBytes = MAX_ARCHIVE_FILE_BYTES): ArchiveFile | undefined {
  return pickFile(files, isTextFile, () => 0, maxBytes);
}

export function pickPdfFile(
  files: ArchiveFile[],
  options: { degraded?: boolean; maxBytes?: number } = {}
): ArchiveFile | undefined {
  if (options.degraded) return undefined;
  return pickFile(files, isPdfFile, pdfRank, options.maxBytes ?? MAX_ARCHIVE_FILE_BYTES);
}

export function downloadUrl(id: string, name: string): string {
  const filePath = name.split("/").map(encodeURIComponent).join("/");
  return `https://archive.org/download/${encodeURIComponent(id)}/${filePath}`;
}

// Reads at most `cap` bytes from the response; undefined on any failure, so a caller
// can fall through to the next source.
export async function fetchBytes(fetchImpl: typeof fetch, url: string, cap: number): Promise<Buffer | undefined> {
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch {
    return undefined;
  }
  if (!res.ok || !res.body) return undefined;
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    let result: { done: boolean; value?: Uint8Array };
    try {
      result = await reader.read();
    } catch {
      return undefined;
    }
    if (result.done || !result.value) break;
    total += result.value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(result.value);
  }
  return total > 0 ? Buffer.concat(chunks) : undefined;
}