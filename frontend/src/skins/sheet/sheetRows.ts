// What each sheet of the spreadsheet skin holds, as rows of plain cells: the library
// ("Danh_muc"), a story's chapter list, and a chapter's text one paragraph per row.

import { ChapterLiveState, LiveCrawl } from "../../hooks/useCrawlJob";
import { ChapterLine } from "../../lib/skins/chapterLines";
import { ShownStatus, shownStatus } from "../../lib/skins/chapters";
import { pad, sheetName } from "../../lib/skins/slug";
import { StoredChapter, StorySummary } from "../../types";
import { HEADER_ROWS, formatDate, formatNumber, pageBounds } from "./sheetModel";

export interface SheetCell {
  text: string;
  tone?: "negative" | "dim";
  bold?: boolean;
  italic?: boolean;
  align?: "right" | "center";
  // Text runs on over the empty cells to its right instead of being cut at the border.
  spill?: boolean;
}

export interface SheetRow {
  key: string;
  // The row number at the left edge.
  label: number;
  cells: SheetCell[];
  header?: boolean;
  // A story id (library) or a chapter order (story sheet) that Enter / double-click opens.
  target?: string | number;
  // Kind of chapter line, for the chapter sheet's text styling.
  line?: ChapterLine["kind"];
  // Why a chapter row does not open: its text is not there yet, or its download failed.
  blocked?: "pending" | "error";
}

// Column widths (CSS) per sheet, the row-number column not included. Data columns come
// first; the empty ones after them run the grid past the right edge of a wide screen, as
// a real sheet does.
const filler = (count: number, width = "72px") => Array.from({ length: count }, () => width);
export const COLUMNS = {
  library: ["52px", "220px", "280px", "92px", "80px", "64px", "100px", "88px", ...filler(17)],
  story: ["64px", "440px", "96px", "84px", ...filler(21)],
  // About 90 characters a line: wide enough to look like a text column, narrow enough to read.
  chapter: ["52px", "min(720px, 70vw)", ...filler(20, "64px")],
} as const;

const text = (value: string, extra: Omit<SheetCell, "text"> = {}): SheetCell => ({ text: value, ...extra });
const number = (value: number, extra: Omit<SheetCell, "text"> = {}): SheetCell => ({
  text: formatNumber(value),
  align: "right",
  ...extra,
});

function headerRow(titles: string[]): SheetRow {
  return { key: "header", label: 1, header: true, cells: titles.map((title) => text(title, { bold: true })) };
}

// Rows standing in for data that is loading, missing or failed: the message in B2, any
// detail (the error itself, what to do) under it in B3.
export function messageRows(message: string, detail = "", tone?: SheetCell["tone"]): SheetRow[] {
  const row = (key: string, value: string, offset: number): SheetRow => ({
    key,
    label: HEADER_ROWS + 1 + offset,
    cells: [text(""), text(value, { tone, spill: true })],
  });
  return detail ? [row("message", message, 0), row("detail", detail, 1)] : [row("message", message, 0)];
}

export const LIBRARY_HEADER = ["STT", "Mã", "Tên", "Số chương", "Đã tải", "Lỗi", "Cập nhật", "Tiến độ"];

export function libraryRows(
  stories: StorySummary[],
  live: Record<string, LiveCrawl | undefined>,
  neutral: boolean,
  page: number
): SheetRow[] {
  const { start, end } = pageBounds(page, stories.length);
  const rows = [headerRow(LIBRARY_HEADER)];
  for (let index = start; index < end; index++) {
    const story = stories[index];
    const crawl = live[story.id];
    rows.push({
      key: story.id,
      label: index + HEADER_ROWS + 1,
      target: story.id,
      cells: [
        number(index + 1),
        text(sheetName(story.title, index, neutral)),
        text(neutral ? `Module ${pad(index + 1, 2)}` : story.title),
        number(story.chapterCount),
        number(story.doneCount),
        number(story.errorCount, story.errorCount > 0 ? { tone: "negative" } : {}),
        text(formatDate(story.updatedAt), { align: "right" }),
        crawl ? text(`${crawl.cursor}/${crawl.total}`, { align: "right" }) : text(""),
      ],
    });
  }
  return rows;
}

const STATUS_CELL: Record<ShownStatus, SheetCell> = {
  done: text("Xong"),
  pending: text("Chờ", { tone: "dim" }),
  running: text("Đang tải", { tone: "dim", italic: true }),
  error: text("Lỗi", { tone: "negative" }),
};

export const STORY_HEADER = ["#", "Tiêu đề", "Trạng thái", "Số từ"];

export function storyRows(
  chapters: StoredChapter[],
  page: number,
  neutral: boolean,
  words: Record<number, number>,
  liveStates?: Record<string, ChapterLiveState>
): SheetRow[] {
  const { start, end } = pageBounds(page, chapters.length);
  const rows = [headerRow(STORY_HEADER)];
  for (let index = start; index < end; index++) {
    const chapter = chapters[index];
    const status = shownStatus(chapter, liveStates);
    const count = words[chapter.order];
    rows.push({
      key: String(chapter.order),
      label: index + HEADER_ROWS + 1,
      target: status === "done" ? chapter.order : undefined,
      blocked: status === "done" ? undefined : status === "error" ? "error" : "pending",
      cells: [
        number(chapter.order),
        text(neutral ? `Mục ${pad(chapter.order, 4)}` : chapter.title, status === "done" ? {} : { tone: "dim" }),
        STATUS_CELL[status],
        count !== undefined ? number(count) : text(""),
      ],
    });
  }
  return rows;
}

export const CHAPTER_HEADER = ["#", "Nội dung"];

export function chapterRows(lines: ChapterLine[]): SheetRow[] {
  const rows = [headerRow(CHAPTER_HEADER)];
  lines.forEach((line, index) => {
    rows.push({
      key: String(index),
      label: index + HEADER_ROWS + 1,
      line: line.kind,
      cells: [
        number(index + 1, { tone: "dim" }),
        text(line.text, {
          bold: line.kind === "heading",
          italic: line.kind === "media",
          tone: line.kind === "media" ? "dim" : undefined,
        }),
      ],
    });
  });
  return rows;
}
