// The chat skin's names and counts: a story is a space, a chapter a thread. Pure, so the
// rail, the home list and the threads panel all agree on what a thing is called.

import { Translate } from "../../i18n";
import { hashString } from "../../lib/skins/hash";
import { pad, storyFolderName } from "../../lib/skins/slug";

// Neutral names show a numbered team instead of anything taken from the title.
export function spaceName(title: string, index: number, neutral: boolean, t: Translate): string {
  if (neutral) return t("Team {n}", { n: pad(index + 1, 2) });
  return storyFolderName(title, index, false);
}

// ---- Part labels ---------------------------------------------------------------------
//
// "Chương 3:", "Chapter 12 –", "Quyển 2 - Chương 5." in front of a title say "book" to
// anyone glancing at a chat, so they are taken off; what follows ("Gặp lại") is kept.
// "Chương"/"Chapter" count with any separator after their number. "Hồi", "Tập", "Phần",
// "Part"… are everyday words too ("Hồi 3 giờ sáng…"), so they count only when a
// separator, the end, or another label follows.

const NUMBER_WORDS = "một|hai|ba|bốn|tư|năm|lăm|nhăm|sáu|bảy|tám|chín|mười|mươi|mốt|trăm|linh|lẻ|nhất";
const NUMBER = `(?:\\d+(?:[.,]\\d+)?|[ivxlcdm]+|(?:${NUMBER_WORDS})(?:\\s+(?:${NUMBER_WORDS}))*)`;
// A label's word ends at a space, a separator, a closing bracket or the end (\b only knows ASCII).
const WORD_END = "(?=$|[\\s:.,;|)\\]】」\\-–—])";
const OPEN = "[\\[(【「]?\\s*";
const STRONG = new RegExp(
  `^${OPEN}(?:(?:chương|chuong|chapter|chap|ch\\.)\\s*(?:thứ\\s+)?(?:${NUMBER}|cuối|kết|mở\\s+đầu)${WORD_END}|第\\s*[\\d一二三四五六七八九十百千零〇两]+\\s*[章节節回卷部集话話])`,
  "iu"
);
const WEAK = new RegExp(
  `^${OPEN}(?:(?:hồi|quyển|quyen|tập|phần|part|book|volume|vol\\.|episode|ep\\.)\\s*(?:thứ\\s+)?${NUMBER}|(?:ngoại\\s+truyện|phiên\\s+ngoại|văn\\s+án|tiết\\s+tử|prologue|epilogue)(?:\\s*${NUMBER})?)${WORD_END}`,
  "iu"
);
const SEPARATOR = /^[\s:.,;|)\]】」\-–—]+/u;

function collapse(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

// One label off the front, or null when the text does not start with one.
function stripOne(text: string): string | null {
  const strong = STRONG.exec(text);
  if (strong) return text.slice(strong[0].length).replace(SEPARATOR, "");
  const weak = WEAK.exec(text);
  if (!weak) return null;
  const tail = text.slice(weak[0].length);
  const next = tail.trimStart();
  if (next === "" || /^[:.,;|)\]】」\-–—]/u.test(tail) || /^\s+[\-–—|:]/u.test(tail) || STRONG.test(next) || WEAK.test(next))
    return tail.replace(SEPARATOR, "");
  return null;
}

/** A title without its leading part labels ("Chương 3: Gặp lại" → "Gặp lại"); "" when that was all. */
export function withoutPartLabel(title: string): string {
  let rest = collapse(title);
  // A few rounds: "Quyển 2 - Chương 5: …" carries two.
  for (let round = 0; round < 4; round++) {
    const next = stripOne(rest);
    if (next === null) break;
    rest = next.trim();
  }
  return rest;
}

// A thread is named after its chapter (without the part label) when titles may show,
// else, or when nothing is left, by its number only.
export function threadLabel(order: number, title: string, neutral: boolean, t: Translate): string {
  const fallback = t("Thread {n}", { n: pad(order, 4) });
  if (neutral) return fallback;
  return withoutPartLabel(title) || fallback;
}

// Two letters for a space's square avatar: the first letters of its first two words.
export function spaceInitials(name: string): string {
  const words = name.split(/[\s\-_]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toUpperCase() || "#";
}

// Avatar colours 1–8 (0 is kept for "you").
export function toneFor(key: string): number {
  return (hashString(key) % 8) + 1;
}

export function memberCount(storyId: string): number {
  return 4 + (hashString(`members:${storyId}`) % 12);
}

/**
 * Threads not read yet, from the saved reading position. Orders are 1-based and in reading
 * order, so without the chapter list the read ones are taken to be the first `order`
 * (exact whenever downloaded chapters are a prefix, which is the usual case).
 */
export function unreadEstimate(doneCount: number, savedOrder: number | null): number {
  if (savedOrder === null) return doneCount;
  return Math.max(0, Math.min(doneCount, doneCount - savedOrder));
}

// The exact count when the space's thread list is at hand.
export function unreadExact(readableOrders: number[], savedOrder: number | null): number {
  if (savedOrder === null) return readableOrders.length;
  return readableOrders.filter((order) => order > savedOrder).length;
}

export function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

// ---- Paging ------------------------------------------------------------------------

export const THREAD_PAGE = 50;
export const HOME_PAGE = 50;
export const RAIL_STEP = 30;

export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

export function pageOfIndex(index: number, size: number): number {
  return index < 0 ? 0 : Math.floor(index / size);
}

export function pageBounds(page: number, size: number, total: number): { start: number; end: number } {
  const last = pageCount(total, size) - 1;
  const clamped = Math.min(Math.max(0, page), last);
  const start = clamped * size;
  return { start, end: Math.min(total, start + size) };
}

// ---- Times -------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "9:41 AM" — the clock the chat shows beside a name.
export function clockText(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours < 12 ? "AM" : "PM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${pad(mins, 2)} ${suffix}`;
}

// The home list's right-hand time: the clock today, the date before, the year when not this one.
export function listTime(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (sameDay(date, now)) return clockText(date.getHours() * 60 + date.getMinutes());
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}
