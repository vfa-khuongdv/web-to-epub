// Grid arithmetic for the spreadsheet skin: column letters, cell addresses, paging of long
// sheets and moving the selected cell. Pure, so the shell stays about wiring.

import { pad } from "../../lib/skins/slug";

// Rows drawn at once on a library or story sheet; a story can have thousands of chapters.
export const PAGE_SIZE = 200;
// Sheet tabs kept open, the library sheet included.
export const MAX_SHEETS = 8;
export const WORKBOOK = "Bao_cao_tong_hop.xlsx";
export const LIBRARY_SHEET = "Danh_muc";
// Data sheets carry one header row (row 1) above their data.
export const HEADER_ROWS = 1;

export interface CellPos {
  // Index into the sheet's rows (0 = the header row), not the label shown at the left.
  row: number;
  col: number;
}

// 0 → A, 25 → Z, 26 → AA, as spreadsheets name their columns.
export function columnName(index: number): string {
  let name = "";
  let n = Math.max(0, Math.floor(index)) + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function cellAddress(col: number, rowLabel: number): string {
  return `${columnName(col)}${rowLabel}`;
}

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

export function clampPage(page: number, total: number, size = PAGE_SIZE): number {
  return Math.min(Math.max(0, Math.floor(page)), pageCount(total, size) - 1);
}

// The slice of items a page shows: [start, end).
export function pageBounds(page: number, total: number, size = PAGE_SIZE): { start: number; end: number } {
  const start = clampPage(page, total, size) * size;
  return { start, end: Math.min(Math.max(0, total), start + size) };
}

export function pageOfIndex(index: number, size = PAGE_SIZE): number {
  return Math.floor(Math.max(0, index) / size);
}

export function clampPos(pos: CellPos, rows: number, cols: number): CellPos {
  return {
    row: Math.min(Math.max(0, pos.row), Math.max(0, rows - 1)),
    col: Math.min(Math.max(0, pos.col), Math.max(0, cols - 1)),
  };
}

export interface MoveKey {
  key: string;
  // Ctrl on Windows/Linux, Cmd on a Mac: jump to the edge of the sheet.
  jump: boolean;
}

// Where an arrow/Home/End key takes the selected cell, or null when the key does not move it.
export function moveSelection(pos: CellPos, { key, jump }: MoveKey, rows: number, cols: number): CellPos | null {
  const lastRow = Math.max(0, rows - 1);
  const lastCol = Math.max(0, cols - 1);
  const { row, col } = clampPos(pos, rows, cols);
  switch (key) {
    case "ArrowUp":
      return { row: jump ? 0 : Math.max(0, row - 1), col };
    case "ArrowDown":
      return { row: jump ? lastRow : Math.min(lastRow, row + 1), col };
    case "ArrowLeft":
      return { row, col: jump ? 0 : Math.max(0, col - 1) };
    case "ArrowRight":
      return { row, col: jump ? lastCol : Math.min(lastCol, col + 1) };
    case "Home":
      return jump ? { row: 0, col: 0 } : { row, col: 0 };
    case "End":
      return jump ? { row: lastRow, col: lastCol } : { row, col: lastCol };
    default:
      return null;
  }
}

/**
 * A move on a paged sheet: stepping down from the last row of a page continues on the
 * next page's first data row, and stepping up from its first data row goes back to the
 * previous page's last row, so the arrow keys walk the whole list.
 */
export function pagedMove(
  pos: CellPos,
  move: MoveKey,
  sheet: { rows: number; cols: number; page: number; pages: number }
): { pos: CellPos; page: number } | null {
  const { rows, cols, page, pages } = sheet;
  if (!move.jump && move.key === "ArrowDown" && pos.row >= rows - 1 && page < pages - 1) {
    return { pos: { row: HEADER_ROWS, col: pos.col }, page: page + 1 };
  }
  if (!move.jump && move.key === "ArrowUp" && pos.row <= HEADER_ROWS && page > 0) {
    // The previous page is always full, so its last row is known without loading it.
    return { pos: { row: HEADER_ROWS + PAGE_SIZE - 1, col: pos.col }, page: page - 1 };
  }
  const next = moveSelection(pos, move, rows, cols);
  return next ? { pos: next, page } : null;
}

// A chapter sheet shows line i of the chapter on row i + 1 (row 0 is its header).
export function lineToRow(line: number): number {
  return Math.max(0, line) + HEADER_ROWS;
}

export function rowToLine(row: number): number {
  return Math.max(0, row - HEADER_ROWS);
}

export function chapterSheetName(order: number, neutral: boolean): string {
  return `${neutral ? "Part" : "Ch"}_${pad(order, 4)}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

// dd/mm/yyyy, the way a Vietnamese report writes dates; blank for a missing date.
export function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getDate(), 2)}/${pad(date.getMonth() + 1, 2)}/${date.getFullYear()}`;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// What the status bar sums up for the selected cell, like a spreadsheet does.
export function selectionSummary(text: string, wordsToo: boolean): { label: string; value: string }[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const summary = [{ label: "Count", value: "1" }];
  const numeric = trimmed.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(numeric)) summary.push({ label: "Sum", value: formatNumber(Number(numeric)) });
  else if (wordsToo) summary.push({ label: "Words", value: formatNumber(countWords(trimmed)) });
  return summary;
}
