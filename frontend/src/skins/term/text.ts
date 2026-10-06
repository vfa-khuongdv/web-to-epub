// A chapter as the terminal shows it: a Markdown file hard-wrapped at a fixed measure,
// the way a README reads in a pager. The wrapped rows ARE the file's lines here, so the
// pager's "lines 41-80/220", `head -n 20` and `wc -l` all count the same thing. Each row
// remembers the chapter line (paragraph) it came from: the reading position is saved by
// paragraph, so it survives a different window width.
import { ChapterLine } from "../../lib/skins/chapterLines";

// The measure files are wrapped at: what a hard-wrapped text file uses, and a
// comfortable line length for reading. A narrower window wraps at its own width.
export const FILE_WIDTH = 80;
export const MIN_WIDTH = 20;

export interface FileRow {
  text: string;
  // Index of the chapter line the row belongs to (a blank row: the line before it).
  line: number;
  kind: ChapterLine["kind"] | "blank";
}

// Terminal cell width of a code point: wide (CJK, fullwidth, emoji) take two cells,
// combining marks none. Enough for the text chapters carry; not a full wcwidth.
function cellWidth(codePoint: number): number {
  if (codePoint >= 0x300 && codePoint <= 0x36f) return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    codePoint >= 0x1f300
  ) {
    return 2;
  }
  return 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += cellWidth(char.codePointAt(0)!);
  return width;
}

// Splits a word too long for a row at the cell limit.
function splitLong(word: string, width: number): string[] {
  const parts: string[] = [];
  let part = "";
  let used = 0;
  for (const char of word) {
    const w = cellWidth(char.codePointAt(0)!);
    if (used + w > width && part) {
      parts.push(part);
      part = "";
      used = 0;
    }
    part += char;
    used += w;
  }
  if (part) parts.push(part);
  return parts;
}

/** Greedy word wrap at `width` cells; text is already one line with single spaces. */
export function wrapText(text: string, width: number): string[] {
  const limit = Math.max(1, width);
  const rows: string[] = [];
  let row = "";
  let used = 0;
  for (const word of text.normalize("NFC").split(" ")) {
    if (!word) continue;
    const w = displayWidth(word);
    if (row && used + 1 + w <= limit) {
      row += ` ${word}`;
      used += 1 + w;
      continue;
    }
    if (row) rows.push(row);
    if (w <= limit) {
      row = word;
      used = w;
    } else {
      const parts = splitLong(word, limit);
      rows.push(...parts.slice(0, -1));
      row = parts[parts.length - 1];
      used = displayWidth(row);
    }
  }
  if (row) rows.push(row);
  return rows;
}

// The width a file is wrapped at in a window `columns` cells wide.
export function fileWidth(columns: number): number {
  return Math.max(MIN_WIDTH, Math.min(FILE_WIDTH, Math.floor(columns) - 1));
}

/**
 * The chapter as file rows: headings as Markdown headings, paragraphs wrapped, media as
 * their address-less placeholder, a blank row between blocks.
 */
export function fileRows(lines: ChapterLine[], width: number): FileRow[] {
  const rows: FileRow[] = [];
  lines.forEach((line, index) => {
    if (index > 0) rows.push({ text: "", line: index - 1, kind: "blank" });
    if (line.kind === "heading") {
      // A heading is one Markdown line; a long one continues indented under its "# ".
      wrapText(line.text, width - 2).forEach((text, at) =>
        rows.push({ text: at === 0 ? `# ${text}` : `  ${text}`, line: index, kind: "heading" })
      );
    } else {
      for (const text of wrapText(line.text, width)) rows.push({ text, line: index, kind: line.kind });
    }
  });
  return rows;
}

// The first row of a chapter line (for a saved position), clamped to the file.
export function rowOfLine(rows: FileRow[], line: number): number {
  if (rows.length === 0 || line <= 0) return 0;
  const at = rows.findIndex((row) => row.kind !== "blank" && row.line >= line);
  return at < 0 ? rows.length - 1 : at;
}

// The chapter line shown at a row: a blank row counts as the paragraph after it.
export function lineAtRow(rows: FileRow[], row: number): number {
  const current = rows[row];
  if (!current) return 0;
  if (current.kind !== "blank") return current.line;
  return rows[row + 1]?.line ?? current.line;
}

// The file's bytes as it would sit on disk (UTF-8, one newline per row).
export function fileBytes(rows: FileRow[]): number {
  if (rows.length === 0) return 0;
  return new TextEncoder().encode(rows.map((row) => row.text).join("\n") + "\n").length;
}

// One character in, one character out: letters lose case and Vietnamese marks, so "tro ve"
// finds "Trở về" and a match's position in the folded text is its position on screen.
export function fold(text: string): string {
  let out = "";
  for (const char of text) {
    const base = char.normalize("NFD").replace(/[̀-ͯ]/g, "") || char;
    const folded = base.replace(/[đĐ]/g, "d").toLowerCase();
    // Same number of UTF-16 units as the original, or the original itself.
    out += folded.length === char.length ? folded : char;
  }
  return out;
}

// [start, end) of every match of `pattern` in `text`, ignoring case and marks.
export function matchRanges(text: string, pattern: string): [number, number][] {
  const needle = fold(pattern);
  if (!needle) return [];
  const haystack = fold(text);
  const ranges: [number, number][] = [];
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    ranges.push([at, at + needle.length]);
    at = haystack.indexOf(needle, at + needle.length);
  }
  return ranges;
}

// The next row (after `from`, or before it going back) holding the pattern; -1 if none.
export function findRow(rows: FileRow[], pattern: string, from: number, direction: 1 | -1): number {
  const needle = fold(pattern);
  if (!needle) return -1;
  for (let at = from + direction; at >= 0 && at < rows.length; at += direction) {
    if (fold(rows[at].text).includes(needle)) return at;
  }
  return -1;
}
