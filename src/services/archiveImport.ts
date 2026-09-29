import { ContentBlock } from "../types";
import { ImportedBook, ImportedChapter } from "./epubImport";
import { t } from "./lang";
import { CHAPTER_HEADING_RE, joinLine, MAX_PAGES, PAGES_PER_CHUNK, SENTENCE_END_RE } from "./pdfImport";

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

// A text file with less than this is a scan without a text layer (or a picture book):
// the PDF source is tried instead, which keeps the page images.
export const MIN_TEXT_CHARS = 200;

const PAGE_NUMBER_RE = /^[-–—\s]*\d+[-–—\s]*$/;

interface FlatLine {
  text: string;
  indented: boolean;
  page: number;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// One page of a DjVuTXT file: trailing spaces gone, bare leading/trailing page numbers
// dropped, empty lines gone. Leading indentation is kept — it marks a new paragraph.
function pageLines(page: string): string[] {
  const lines = page.split("\n").map((line) => line.replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const kept = lines.filter((line) => line.trim());
  return kept.filter((line, index) => {
    const edge = index === 0 || index === kept.length - 1;
    return !(edge && PAGE_NUMBER_RE.test(line.trim()));
  });
}

// Turn OCR text into a book: pages split on form feeds, chapters from heading lines
// (otherwise 20-page chunks), paragraphs from indentation, sentence ends and the page's
// own line width — there are no coordinates to use, unlike a PDF.
export function textToBook(text: string, meta: { title: string; author?: string; language?: string }): ImportedBook {
  const pages = text.split("\f").map(pageLines).filter((lines) => lines.length > 0);
  if (pages.length > MAX_PAGES) throw new ArchiveTooManyPagesError(MAX_PAGES);

  const flat: FlatLine[] = [];
  const pageWidth = new Map<number, number>();
  pages.forEach((lines, page) => {
    for (const raw of lines) {
      const line = raw.trim();
      flat.push({ text: line, indented: /^\s/.test(raw), page });
      pageWidth.set(page, Math.max(pageWidth.get(page) ?? 0, line.length));
    }
  });

  const starts: { index: number; title: string }[] = [];
  flat.forEach((line, index) => {
    if (line.text.length <= 120 && CHAPTER_HEADING_RE.test(line.text)) starts.push({ index, title: line.text });
  });

  const chapters: ImportedChapter[] = [];
  if (starts.length >= 2) {
    const segments = [
      { start: 0, end: starts[0].index, title: meta.title, skipHeading: false },
      ...starts.map((start, index) => ({
        start: start.index,
        end: starts[index + 1]?.index ?? flat.length,
        title: start.title,
        skipHeading: true,
      })),
    ];
    for (const segment of segments) {
      const blocks = blocksFor(flat, pageWidth, segment.start, segment.end, segment.skipHeading);
      if (blocks.length) chapters.push({ title: segment.title, blocks });
    }
  } else {
    for (let page = 0; page < pages.length; page += PAGES_PER_CHUNK) {
      const last = Math.min(page + PAGES_PER_CHUNK, pages.length);
      const start = flat.findIndex((line) => line.page === page);
      const end = flat.findIndex((line) => line.page === last);
      const title = pages.length <= PAGES_PER_CHUNK ? meta.title : t("Pages {from}–{to}", { from: page + 1, to: last });
      const blocks = blocksFor(flat, pageWidth, start, end === -1 ? flat.length : end, false);
      if (blocks.length) chapters.push({ title, blocks });
    }
  }

  return { title: meta.title, author: meta.author, language: meta.language, chapters };
}

function blocksFor(
  flat: FlatLine[],
  pageWidth: Map<number, number>,
  from: number,
  to: number,
  skipHeading: boolean
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let paragraph: string | undefined;
  let previous: FlatLine | undefined;
  const flush = () => {
    if (paragraph) blocks.push({ type: "paragraph", text: escapeHtml(paragraph) });
    paragraph = undefined;
  };
  for (let i = skipHeading ? from + 1 : from; i < to; i++) {
    const line = flat[i];
    const endsSentence = previous ? SENTENCE_END_RE.test(previous.text) : true;
    let breaks = !paragraph || !previous || line.indented;
    if (!breaks && previous) {
      const width = pageWidth.get(previous.page) ?? previous.text.length;
      breaks =
        previous.page !== line.page
          ? endsSentence
          : endsSentence && (previous.text.length < width * 0.9 || line.text.length < width * 0.9);
    }
    if (breaks) {
      flush();
      paragraph = line.text;
    } else {
      paragraph = joinLine(paragraph ?? "", line.text);
    }
    previous = line;
  }
  flush();
  return blocks;
}