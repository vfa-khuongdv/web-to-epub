// The code-hosting skin as plain data: names, paging, the made-up details a file table
// shows beside each file (hash, message, time), tab titles, and a chapter as a Markdown
// source file. Everything here is deterministic, so a reload draws the same page.

import { ChapterLine } from "../../lib/skins/chapterLines";
import { pad } from "../../lib/skins/slug";
import { ShownStatus } from "../../lib/skins/chapters";
import { hashString } from "../../lib/skins/hash";

export const ORG = "team";
export const BRANCH = "main";
export const BOT = "team-bot";
export const REPOS_PER_PAGE = 30;
// A directory of a thousand files is one page on the real site; a hundred rows keeps the
// table quick to draw and the pagination believable.
export const FILES_PER_PAGE = 100;

// Repository descriptions, picked by position: generic team work, never the story. They
// are i18n keys.
export const DESCRIPTIONS = [
  "Internal documentation for the team.",
  "Shared notes and reference material.",
  "Working drafts and meeting notes.",
  "Guides, specs and how-tos for the project.",
];

export function descriptionKey(index: number): string {
  return DESCRIPTIONS[((index % DESCRIPTIONS.length) + DESCRIPTIONS.length) % DESCRIPTIONS.length];
}

// A short commit hash: seven hex digits, as the site abbreviates them.
export function shortSha(seed: string): string {
  const first = hashString(seed).toString(16).padStart(8, "0");
  const second = hashString(`${seed}#`).toString(16).padStart(8, "0");
  return (first + second).slice(0, 7);
}

// ---- Paging ---------------------------------------------------------------------------

export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

export function clampPage(page: number, total: number, size: number): number {
  return Math.min(Math.max(0, page), pageCount(total, size) - 1);
}

export function pageSlice<T>(items: T[], page: number, size: number): T[] {
  const start = clampPage(page, items.length, size) * size;
  return items.slice(start, start + size);
}

export function pageOf(index: number, size: number): number {
  return Math.max(0, Math.floor(index / size));
}

export type PageItem = number | "gap";

/**
 * The page links of a pagination bar (0-based pages): the first and last two, and two
 * either side of the current one, with a gap where pages are left out — the way the site
 * draws "1 2 … 7 8 9 10 11 … 40 41". A gap never hides a single page.
 */
export function pageItems(page: number, pages: number): PageItem[] {
  if (pages <= 1) return [0];
  const keep = new Set<number>();
  for (const at of [0, 1, pages - 2, pages - 1]) keep.add(at);
  for (let at = page - 2; at <= page + 2; at++) keep.add(at);
  const shown = [...keep].filter((at) => at >= 0 && at < pages).sort((a, b) => a - b);
  const items: PageItem[] = [];
  shown.forEach((at, index) => {
    const previous = shown[index - 1];
    if (previous !== undefined && at - previous === 2) items.push(previous + 1);
    else if (previous !== undefined && at - previous > 2) items.push("gap");
    items.push(at);
  });
  return items;
}

// ---- Time -----------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/**
 * "3 hours ago", "yesterday", "on Sep 12": the site's relative times (English, as the
 * site itself is). An unreadable date gives "", so a row just shows no time.
 */
export function relativeTime(iso: string | undefined, now: number): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(at)) return "";
  const diff = Math.max(0, now - at);
  if (diff < 45_000) return "just now";
  if (diff < 45 * MINUTE) return plural(Math.max(1, Math.round(diff / MINUTE)), "minute");
  if (diff < 22 * HOUR) return plural(Math.max(1, Math.round(diff / HOUR)), "hour");
  if (diff < 36 * HOUR) return "yesterday";
  if (diff < 30 * DAY) return plural(Math.round(diff / DAY), "day");
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `on ${MONTHS[date.getMonth()]} ${date.getDate()}${sameYear ? "" : `, ${date.getFullYear()}`}`;
}

// Files further back in the list were "changed" earlier: forty minutes per file before
// the repository's own last update, so the newest file is the one changed last.
const FILE_STEP = 40 * MINUTE;

export function fileTime(updatedAt: string, order: number, lastOrder: number): string {
  const at = Date.parse(updatedAt);
  if (Number.isNaN(at)) return updatedAt;
  return new Date(at - Math.max(0, lastOrder - order) * FILE_STEP).toISOString();
}

// ---- Commits --------------------------------------------------------------------------

const DONE_MESSAGES = ["docs: update", "docs: add", "docs: fix typos in", "docs: reword"];

// The last commit of a file, by its state: what a docs repository's history would say.
export function commitMessage(order: number, status: ShownStatus): string {
  const part = `part-${pad(order, 4)}`;
  if (status === "running") return `ci: sync ${part}`;
  if (status === "pending") return `chore: queue ${part}`;
  if (status === "error") return `ci: sync ${part} (failed)`;
  return `${DONE_MESSAGES[hashString(part) % DONE_MESSAGES.length]} ${part}`;
}

// ---- Tab titles -----------------------------------------------------------------------

export type RepoTab = "code" | "issues" | "pulls" | "actions" | "settings";

const TAB_TITLES: Record<Exclude<RepoTab, "code">, string> = {
  issues: "Issues",
  pulls: "Pull requests",
  actions: "Workflow runs",
  settings: "Settings",
};

export interface TitledItem {
  kind: "pull" | "issue";
  number: number;
  title: string;
  author: string;
}

// What the site's own tab would say: the repository, the section, the open file, or the
// open pull request or issue.
export function pageTitle(view: { repo: string | null; tab?: RepoTab; file?: string | null; item?: TitledItem | null }): string {
  const { repo, tab, file, item } = view;
  if (!repo) return "Repositories";
  const full = `${ORG}/${repo}`;
  if (item?.kind === "pull") return `${item.title} by ${item.author} · Pull Request #${item.number} · ${full}`;
  if (item?.kind === "issue") return `${item.title} · Issue #${item.number} · ${full}`;
  if (file) return `${repo}/${file} at ${BRANCH} · ${full}`;
  if (!tab || tab === "code") return full;
  return `${TAB_TITLES[tab]} · ${full}`;
}

// ---- A chapter as a Markdown file ------------------------------------------------------

export interface RawRow {
  // The line number in the gutter.
  number: number;
  text: string;
  // The chapter line this row shows; null for the blank line between two blocks.
  line: number | null;
}

export function markdownSource(line: ChapterLine): string {
  return line.kind === "heading" ? `## ${line.text}` : line.text;
}

// The file's source as the code view shows it: one row per block, a blank row between
// blocks as in a hand-written Markdown file.
export function rawRows(lines: ChapterLine[]): RawRow[] {
  const rows: RawRow[] = [];
  lines.forEach((line, index) => {
    if (index > 0) rows.push({ number: rows.length + 1, text: "", line: null });
    rows.push({ number: rows.length + 1, text: markdownSource(line), line: index });
  });
  return rows;
}

// "N lines (M loc) · X KB" in the file header.
export function fileStats(rows: RawRow[]): { lines: number; loc: number; bytes: number } {
  let bytes = 0;
  let loc = 0;
  for (const row of rows) {
    if (row.text) loc++;
    bytes += utf8Length(row.text) + 1;
  }
  return { lines: rows.length, loc, bytes: Math.max(0, bytes - 1) };
}

function utf8Length(text: string): number {
  let length = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return length;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Bytes`;
  if (bytes < 1024 * 1024) return `${trim(bytes / 1024)} KB`;
  return `${trim(bytes / (1024 * 1024))} MB`;
}

function trim(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

// ---- Reading position -----------------------------------------------------------------

/**
 * The first of `count` stacked elements whose bottom edge is below `threshold` (the
 * bottom of the sticky file header): the line at the top of the screen. `bottomOf` grows
 * with the index, so a binary search does; a chapter of a thousand lines stays cheap on
 * every scroll frame.
 */
export function firstVisible(count: number, bottomOf: (index: number) => number, threshold: number): number {
  let low = 0;
  let high = count - 1;
  let found = count - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (bottomOf(middle) > threshold) {
      found = middle;
      high = middle - 1;
    } else low = middle + 1;
  }
  return Math.max(0, found);
}
