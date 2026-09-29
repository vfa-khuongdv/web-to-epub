import sharp from "sharp";
import { extractImages, getDocumentProxy } from "unpdf";
import { ContentBlock } from "../types";
import { ImportedBook, ImportedChapter, StoredImage, StoreImage } from "./epubImport";
import { t } from "./lang";

// Past any real novel; a PDF claiming more is a mistake or built to exhaust the parser.
export const MAX_PAGES = 5000;
// A page scan is re-encoded as JPEG no wider than this — a Kindle screen, not print.
const SCAN_MAX_WIDTH = 1600;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Without an outline or chapter headings, the book is cut into chunks of this many pages.
export const PAGES_PER_CHUNK = 20;
// pdf.js permission flag for copying text and graphics (PDF spec, table 22, bit 5).
const PERMISSION_COPY = 16;

export class NotPdfError extends Error {
  constructor() {
    super(t("This file is not a readable PDF"));
  }
}

export class PdfTooLargeError extends Error {
  constructor() {
    super(t("This PDF has too many pages to import (maximum {count})", { count: MAX_PAGES }));
  }
}

export class PdfLockedError extends Error {
  constructor() {
    super(t("This PDF is password-protected or does not allow copying, so it cannot be imported"));
  }
}

export function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 1024).includes("%PDF-");
}

export interface ParsePdfOptions {
  storeImage?: StoreImage;
  fallbackTitle?: string;
}

// Shared with services/chapters/scribd.ts, which builds the same line records from a
// Scribd text layer and reuses the block heuristics below.
export interface Line {
  page: number;
  x: number;
  y: number;
  size: number;
  // Where the line's text ends horizontally.
  right: number;
  text: string;
}

// A chapter start: a page and a height on it (PDF y grows upwards, so lines at or below
// `top` belong to the chapter). Outline destinations without a height start at the page top.
interface ChapterStart {
  title: string;
  page: number;
  top: number;
}

// Pieces of a page in reading order: its text lines, or the images of a page that has no
// text layer (a scan).
type PageContent = { page: number; width: number; lines: Line[] } | { page: number; images: string[] };

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;
type TextItem = { str: string; transform: number[]; width: number; hasEOL: boolean };

export const CHAPTER_HEADING_RE = /^(chương|chapter|hồi|quyển|phần|tập|part)\s+([0-9]+|[ivxlc]+)\b/i;
export const SENTENCE_END_RE = /[.!?…:;"'”’»)\]]$/;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function readLines(pdf: PdfDocument, pageNumber: number): Promise<{ width: number; lines: Line[] }> {
  const page = await pdf.getPage(pageNumber);
  const [left, , right] = page.view;
  const content = await page.getTextContent();
  const lines: Line[] = [];
  // Characters per font size on each line: the line's size is its text's, not that of a
  // drop cap opening it.
  const sizes = new Map<Line, Map<number, number>>();
  // Text drawn more than once at the same spot (a faux-bold or shadowed title) is read once.
  const drawn = new Set<string>();
  let current: Line | undefined;
  let currentEnd = 0;
  let currentSize = 0;
  let ended = false;
  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const item = raw as TextItem;
    const [, , c, d, x, y] = item.transform;
    const size = Math.hypot(c, d) || 1;
    const spot = `${Math.round(x)},${Math.round(y)},${item.str}`;
    if (item.str && !drawn.has(spot)) {
      drawn.add(spot);
      const sameLine = current && !ended && Math.abs(current.y - y) < Math.max(size, currentSize) * 0.5;
      if (current && sameLine) {
        // A drop cap is one large letter; the rest of its word follows in the body size.
        // (`current.size` is still the first item's here.)
        const dropCap = current.text.trim().length === 1 && current.size > size * 2 && !!item.str.trim();
        if (dropCap) current.text = current.text.trim();
        const gap = x - currentEnd;
        const needsSpace = !dropCap && gap > size * 0.15 && !/\s$/.test(current.text) && !/^\s/.test(item.str);
        current.text += (needsSpace ? " " : "") + item.str;
      } else {
        current = { page: pageNumber, x, y, size, right: x, text: item.str };
        lines.push(current);
        sizes.set(current, new Map());
      }
      const weights = sizes.get(current)!;
      weights.set(size, (weights.get(size) ?? 0) + item.str.trim().length);
      currentEnd = x + item.width;
      currentSize = size;
      current.right = currentEnd;
      ended = false;
    }
    if (item.hasEOL) ended = true;
  }
  page.cleanup();
  for (const [line, weights] of sizes) {
    line.size = [...weights].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [line.size, -1])[0];
  }
  const kept = lines
    .map((line) => ({ ...line, text: clean(line.text) }))
    .filter((line, index, all) => {
      if (!line.text) return false;
      // A bare number opening or closing a page is its page number.
      const edge = index === 0 || index === all.length - 1;
      return !(edge && /^[-–—\s]*\d+[-–—\s]*$/.test(line.text));
    });
  return { width: right - left, lines: kept };
}

// The page's images as JPEGs, in the order the page paints them.
async function readScan(pdf: PdfDocument, pageNumber: number): Promise<Buffer[]> {
  const encoded: Buffer[] = [];
  const seen = new Set<string>();
  for (const image of await extractImages(pdf, pageNumber)) {
    // Tiny images on an otherwise empty page are decoration, not the scanned page; the
    // same image painted twice on a page is kept once.
    if (image.width < 200 || image.height < 200 || seen.has(image.key)) continue;
    seen.add(image.key);
    const bytes = await sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
      raw: { width: image.width, height: image.height, channels: image.channels as 1 | 3 | 4 },
    })
      .resize({ width: SCAN_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    if (bytes.length <= MAX_IMAGE_BYTES) encoded.push(bytes);
  }
  return encoded;
}

async function outlineStarts(pdf: PdfDocument): Promise<ChapterStart[]> {
  let outline = (await pdf.getOutline()) ?? [];
  // A single top-level entry holding the chapters is usually the book title.
  while (outline.length === 1 && outline[0].items.length > 1) outline = outline[0].items;
  const starts: ChapterStart[] = [];
  for (const entry of outline) {
    try {
      const dest = typeof entry.dest === "string" ? await pdf.getDestination(entry.dest) : entry.dest;
      if (!dest?.length) continue;
      const ref = dest[0];
      const page = typeof ref === "number" ? ref + 1 : (await pdf.getPageIndex(ref)) + 1;
      // [ref, /XYZ, left, top, zoom]; /FitH and /FitBH carry top as their only argument.
      const kind = (dest[1] as { name?: string } | undefined)?.name;
      const topArg = kind === "XYZ" ? dest[3] : kind === "FitH" || kind === "FitBH" ? dest[2] : null;
      const top = typeof topArg === "number" ? topArg + 1 : Infinity;
      const title = clean(entry.title);
      if (title) starts.push({ title, page, top });
    } catch {
      // An entry pointing nowhere is skipped, not fatal.
    }
  }
  return starts.sort((a, b) => a.page - b.page || b.top - a.top);
}

export function mostCommonSize(lines: Line[]): number {
  const weight = new Map<number, number>();
  for (const line of lines) {
    const size = Math.round(line.size * 2) / 2;
    weight.set(size, (weight.get(size) ?? 0) + line.text.length);
  }
  let best = 12;
  let bestWeight = -1;
  for (const [size, total] of weight) {
    if (total > bestWeight) [best, bestWeight] = [size, total];
  }
  return best;
}

export function joinLine(text: string, next: string): string {
  if (/[A-Za-zÀ-ỹ]-$/.test(text) && /^[a-zà-ỹ]/.test(next)) return text.slice(0, -1) + next;
  return `${text} ${next}`;
}

// Turn the lines of one chapter into heading and paragraph blocks. A paragraph ends at a
// larger vertical gap than the body's line spacing, a first-line indent, a change of font
// size, or a line that finishes a sentence well short of the right margin (the only signal
// left when every paragraph is one line); across a page break it continues unless the last
// line finished a sentence.
export function linesToBlocks(lines: Line[], bodySize: number, lineGap: number, margins: Margins): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let paragraph: string | undefined;
  let previous: Line | undefined;
  const flush = () => {
    if (paragraph) blocks.push({ type: "paragraph", text: escapeHtml(paragraph) });
    paragraph = undefined;
  };
  for (const line of lines) {
    if (line.size >= bodySize * 1.15 && line.text.length <= 200) {
      flush();
      const last = blocks[blocks.length - 1];
      // A heading wrapped over two lines is one heading.
      if (last?.type === "heading" && previous && previous.page === line.page && previous.size === line.size) {
        last.text += ` ${escapeHtml(line.text)}`;
      } else {
        blocks.push({ type: "heading", level: 2, text: escapeHtml(line.text) });
      }
      previous = line;
      continue;
    }
    const margin = margins.get(line.page);
    const indented = line.x - (margin?.left ?? line.x) > line.size * 0.8;
    let breaks = !paragraph || !previous || indented || Math.abs(previous.size - line.size) > 0.5;
    if (!breaks && previous) {
      const sentenceEnd = SENTENCE_END_RE.test(paragraph ?? "");
      const shortLine = previous.right < (margins.get(previous.page)?.right ?? previous.right) - previous.size * 3;
      breaks =
        previous.page === line.page
          ? previous.y - line.y > lineGap * 1.25 || (sentenceEnd && shortLine)
          : sentenceEnd;
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

// Left and right edges of the body text on each page.
export type Margins = Map<number, { left: number; right: number }>;

export function lineGapOf(lines: Line[], bodySize: number): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [a, b] = [lines[i - 1], lines[i]];
    if (a.page === b.page && a.y > b.y && Math.abs(a.size - bodySize) < 0.5 && Math.abs(b.size - bodySize) < 0.5) {
      gaps.push(a.y - b.y);
    }
  }
  if (!gaps.length) return bodySize * 1.2;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function stripTitleHeading(blocks: ContentBlock[], title: string): void {
  const first = blocks[0];
  const normalize = (value: string | undefined) => clean(value ?? "").toLowerCase();
  if (first?.type === "heading" && normalize(first.text) === normalize(escapeHtml(title))) blocks.shift();
}

function isBefore(page: number, y: number, start: ChapterStart): boolean {
  return page < start.page || (page === start.page && y > start.top);
}

export async function parsePdf(bytes: Buffer, options: ParsePdfOptions = {}): Promise<ImportedBook> {
  if (!isPdf(bytes)) throw new NotPdfError();
  let pdf: PdfDocument;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    if ((err as { name?: string }).name === "PasswordException") throw new PdfLockedError();
    throw new NotPdfError();
  }

  try {
    const permissions = await pdf.getPermissions();
    if (permissions && !permissions.includes(PERMISSION_COPY)) throw new PdfLockedError();
    if (pdf.numPages > MAX_PAGES) throw new PdfTooLargeError();

    const { info } = (await pdf.getMetadata().catch(() => ({ info: {} }))) as { info: Record<string, unknown> };
    const metaString = (key: string) => (typeof info[key] === "string" ? clean(info[key] as string) : "") || undefined;
    const title = metaString("Title") ?? (options.fallbackTitle?.trim() || undefined) ?? "Untitled";
    const author = metaString("Author");

    const storeImage = options.storeImage ?? (() => "");
    const pages: PageContent[] = [];
    let cover: StoredImage | undefined;
    for (let page = 1; page <= pdf.numPages; page++) {
      const { width, lines } = await readLines(pdf, page);
      // A book's first page is its cover: its first image becomes the book's cover, even
      // when the page also carries text.
      const images = !lines.length || page === 1 ? await readScan(pdf, page) : [];
      if (page === 1 && images.length) cover = { bytes: images[0], extension: "jpg" };
      if (lines.length) pages.push({ page, width, lines });
      else if (images.length) pages.push({ page, images: images.map((bytes) => storeImage(bytes, "jpg")) });
    }

    const allLines = pages.flatMap((content) => ("lines" in content ? content.lines : []));
    if (!allLines.length && !pages.length) throw new NotPdfError();
    const bodySize = mostCommonSize(allLines);
    const lineGap = lineGapOf(allLines, bodySize);
    const margins: Margins = new Map();
    for (const content of pages) {
      if (!("lines" in content)) continue;
      const body = content.lines.filter((line) => Math.abs(line.size - bodySize) < 0.5);
      if (!body.length) continue;
      const left = Math.min(...body.map((line) => line.x));
      // The widest line, or the left margin mirrored when no line reaches the right one
      // (a page of one-line paragraphs).
      const right = Math.max(...body.map((line) => line.right), content.width - left);
      margins.set(content.page, { left, right });
    }

    let starts = await outlineStarts(pdf);
    if (!starts.length) {
      starts = allLines
        .filter((line) => line.text.length <= 120 && CHAPTER_HEADING_RE.test(line.text))
        .map((line) => ({ title: line.text, page: line.page, top: line.y }));
      if (starts.length < 2) starts = [];
    }
    if (!starts.length) {
      for (let page = 1; page <= pdf.numPages; page += PAGES_PER_CHUNK) {
        const last = Math.min(page + PAGES_PER_CHUNK - 1, pdf.numPages);
        const chunkTitle =
          pdf.numPages <= PAGES_PER_CHUNK ? title : t("Pages {from}–{to}", { from: page, to: last });
        starts.push({ title: chunkTitle, page, top: Infinity });
      }
    }

    // Anything before the first chapter (a title page, a foreword) becomes its own chapter.
    const chapterStarts: ChapterStart[] = [{ title, page: 0, top: Infinity }, ...starts];
    // Each chapter's lines and scanned-page images, in reading order.
    const chapterItems: (Line | string)[][] = chapterStarts.map(() => []);
    const chapterFor = (page: number, y: number) => {
      let index = 0;
      for (let i = 1; i < chapterStarts.length; i++) {
        if (!isBefore(page, y, chapterStarts[i])) index = i;
      }
      return index;
    };
    for (const content of pages) {
      if ("lines" in content) {
        for (const line of content.lines) chapterItems[chapterFor(line.page, line.y)].push(line);
      } else {
        chapterItems[chapterFor(content.page, Infinity)].push(...content.images);
      }
    }

    const chapters: ImportedChapter[] = [];
    chapterStarts.forEach((start, index) => {
      const blocks: ContentBlock[] = [];
      let run: Line[] = [];
      const flushRun = () => {
        blocks.push(...linesToBlocks(run, bodySize, lineGap, margins));
        run = [];
      };
      for (const item of chapterItems[index]) {
        if (typeof item === "string") {
          flushRun();
          blocks.push({ type: "image", src: item, alt: "" });
        } else {
          run.push(item);
        }
      }
      flushRun();
      stripTitleHeading(blocks, start.title);
      if (index === 0 && !blocks.length) return;
      chapters.push({ title: start.title, blocks });
    });

    return { title, author, cover, chapters };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
