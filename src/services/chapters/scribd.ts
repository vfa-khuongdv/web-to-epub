import { JSDOM } from "jsdom";
import { ContentBlock, ExtractedChapter } from "../../types";
import { Line, Margins, lineGapOf, linesToBlocks, mostCommonSize } from "../pdfImport";
import { fetchText } from "../toc/http";
import { loadScribdDocument, parseScribdDocumentId } from "../toc/scribd";
import { t } from "../lang";

export const SCRIBD_DOMAINS = ["scribd.com"];

// Chapter URLs look like `https://www.scribd.com/document/571686127#pages=21-40`.
const RANGE_RE = /^pages=(\d+)-(\d+)$/;

// A line's text is drawn as several absolutely-positioned spans (one per font run);
// spans within this fraction of the line's font size sit on the same visual row.
const SAME_ROW_FACTOR = 0.5;
// Rough average glyph width as a fraction of the font size, used only to estimate where
// a row's text ends (the payload has no span widths).
const GLYPH_WIDTH = 0.5;
const DEFAULT_FONT_SIZE = 16;
// A bare number as the first/last row of a page is its page number, not content.
const PAGE_NUMBER_RE = /^[-–—\s]*\d+[-–—\s]*$/;
// Closing punctuation never takes the space a font-run boundary would add.
const NO_SPACE_BEFORE_RE = /^[.,;:!?…)\]}>”’]/;

export interface ScribdChapterRef {
  docId: string;
  from: number;
  to: number;
}

export function parseScribdChapterRef(url: string): ScribdChapterRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const docId = parseScribdDocumentId(url);
  if (!docId) return undefined;
  const match = RANGE_RE.exec(parsed.hash.replace(/^#/, ""));
  if (!match) return undefined;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) return undefined;
  return { docId, from, to };
}

export interface ScribdPagePayload {
  width: number;
  lines: Line[];
  images: { top: number; src: string }[];
}

interface Fragment {
  top: number;
  left: number;
  size: number;
  text: string;
}

function unreadablePage(page: number): Error {
  return new Error(t("Scribd returned an unreadable page ({page}) — try again", { page }));
}

// The payload is a JSONP call carrying the page's inner HTML as a JSON string.
function pageHtml(payload: string, pageNum: number): string {
  const match = /callback\(\[([\s\S]*)\]\)\s*;?\s*$/.exec(payload.trim());
  if (!match) throw unreadablePage(pageNum);
  try {
    const parts = JSON.parse(`[${match[1]}]`) as unknown;
    if (!Array.isArray(parts)) throw new Error("not an array");
    return parts.filter((part): part is string => typeof part === "string").join("");
  } catch {
    throw unreadablePage(pageNum);
  }
}

function fontSizeOf(el: Element): number {
  const holder = el.closest("[style*='font-size']") as HTMLElement | null;
  const size = parseFloat(holder?.style.fontSize ?? "");
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_FONT_SIZE;
}

function cleanText(el: Element): string {
  return (el.textContent ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function joinFragments(parts: Fragment[]): string {
  let text = "";
  for (const part of parts) {
    if (!text) text = part.text;
    else text += NO_SPACE_BEFORE_RE.test(part.text) ? part.text : ` ${part.text}`;
  }
  return text;
}

function rowsFrom(root: Document, pageNum: number): Line[] {
  const fragments: Fragment[] = [];
  root.querySelectorAll("span.a").forEach((span) => {
    const style = (span as HTMLElement).style;
    const top = parseFloat(style.top);
    const left = parseFloat(style.left);
    const text = cleanText(span);
    if (!text || !Number.isFinite(top) || !Number.isFinite(left)) return;
    fragments.push({ top, left, size: fontSizeOf(span), text });
  });
  fragments.sort((a, b) => a.top - b.top || a.left - b.left);

  const groups: Fragment[][] = [];
  for (const fragment of fragments) {
    const row = groups[groups.length - 1];
    const rowSize = row?.reduce((biggest, part) => Math.max(biggest, part.size), 0) ?? 0;
    if (row && Math.abs(fragment.top - row[0].top) < Math.max(fragment.size, rowSize) * SAME_ROW_FACTOR) row.push(fragment);
    else groups.push([fragment]);
  }

  const rows: Line[] = groups.map((parts) => {
    parts.sort((a, b) => a.left - b.left);
    const weights = new Map<number, number>();
    let width = 0;
    for (const part of parts) {
      weights.set(part.size, (weights.get(part.size) ?? 0) + part.text.length);
      width += part.text.length * part.size * GLYPH_WIDTH;
    }
    let size = parts[0].size;
    let bestWeight = -1;
    for (const [candidate, weight] of weights) {
      if (weight > bestWeight) [size, bestWeight] = [candidate, weight];
    }
    const x = Math.min(...parts.map((part) => part.left));
    // y grows upwards (pdfImport's convention), so a bigger top sits lower.
    return { page: pageNum, x, y: -parts[0].top, size, right: x + width, text: joinFragments(parts) };
  });

  // A page number is the first/last text row, away from the body.
  if (rows.length && PAGE_NUMBER_RE.test(rows[0].text)) rows.shift();
  if (rows.length && PAGE_NUMBER_RE.test(rows[rows.length - 1].text)) rows.pop();

  return rows;
}

/**
 * Read one page payload into positioned lines (for the shared paragraph heuristics in
 * pdfImport.ts) and images. Scan pages carry only an image_layer; text pages carry a
 * text_layer, sometimes next to figures.
 */
export function parseScribdPagePayload(payload: string, pageNum: number): ScribdPagePayload {
  const html = pageHtml(payload, pageNum);
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const page = document.querySelector(".newpage") as HTMLElement | null;
  const width = parseFloat(page?.style.width ?? "");
  const lines = rowsFrom(document, pageNum);

  const images: { top: number; src: string }[] = [];
  document.querySelectorAll("img.absimg").forEach((img) => {
    const raw = img.getAttribute("orig") ?? img.getAttribute("src") ?? "";
    if (!/^https?:/i.test(raw)) return;
    const top = parseFloat((img as HTMLElement).style.top);
    images.push({ top: Number.isFinite(top) ? top : 0, src: raw.replace(/^http:\/\//i, "https://") });
  });
  images.sort((a, b) => a.top - b.top);

  return { width: Number.isFinite(width) ? width : 0, lines, images };
}

type ChapterItem =
  | { kind: "line"; page: number; top: number; line: Line }
  | { kind: "image"; page: number; top: number; src: string };

/**
 * Fetch one chapter: the pages of its range, each from the payload URL the viewer page
 * listed. Scanned pages become image blocks, text pages are rebuilt into paragraphs with
 * the same heuristics used for PDF imports.
 */
export async function fetchScribdChapter(url: string): Promise<ExtractedChapter> {
  const ref = parseScribdChapterRef(url);
  if (!ref) {
    throw new Error(
      t("This is not a Scribd chapter URL: {url} — add the document again to refresh its chapter list", { url })
    );
  }

  const document = await loadScribdDocument(url);
  const pages = document.pages.filter((page) => page.pageNum >= ref.from && page.pageNum <= ref.to);
  if (pages.length === 0) {
    throw new Error(
      t("No pages found for this Scribd chapter range ({from}–{to}): {url}", {
        from: ref.from,
        to: ref.to,
        url,
      })
    );
  }

  const items: ChapterItem[] = [];
  const pageWidths = new Map<number, number>();
  for (const page of pages) {
    const parsed = parseScribdPagePayload(await fetchText(page.contentUrl), page.pageNum);
    pageWidths.set(page.pageNum, parsed.width);
    for (const line of parsed.lines) items.push({ kind: "line", page: page.pageNum, top: -line.y, line });
    for (const image of parsed.images) items.push({ kind: "image", page: page.pageNum, top: image.top, src: image.src });
  }
  items.sort((a, b) => a.page - b.page || a.top - b.top);

  const allLines = items.flatMap((item) => (item.kind === "line" ? [item.line] : []));
  const bodySize = mostCommonSize(allLines);
  const lineGap = lineGapOf(allLines, bodySize);

  // Same margin rules as the PDF import: body-sized lines only, and the right margin is
  // mirrored from the left when no line reaches it.
  const margins: Margins = new Map();
  for (const [pageNum, width] of pageWidths) {
    const body = allLines.filter((line) => line.page === pageNum && Math.abs(line.size - bodySize) < 0.5);
    if (!body.length) continue;
    const left = Math.min(...body.map((line) => line.x));
    const right = Math.max(...body.map((line) => line.right), width > left ? width - left : 0);
    margins.set(pageNum, { left, right });
  }

  const blocks: ContentBlock[] = [];
  let run: Line[] = [];
  const flushRun = () => {
    blocks.push(...linesToBlocks(run, bodySize, lineGap, margins));
    run = [];
  };
  for (const item of items) {
    if (item.kind === "line") run.push(item.line);
    else {
      flushRun();
      blocks.push({ type: "image", src: item.src, alt: "" });
    }
  }
  flushRun();

  if (blocks.length === 0) {
    throw new Error(t("Could not read any content from this Scribd chapter: {url}", { url }));
  }

  return { sourceUrl: url, title: t("Pages {from}–{to}", { from: ref.from, to: ref.to }), blocks };
}
