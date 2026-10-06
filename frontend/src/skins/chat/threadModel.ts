// A chapter as a chat thread: a date divider on top, headings as dividers, and every
// paragraph a message from one of a few made-up colleagues, grouped the way a chat groups
// a person's consecutive messages. Who says what and when is derived from the space and
// the thread only, so a thread reads the same each time it is opened.

import { ChapterLine } from "../../lib/skins/chapterLines";
import { hashString } from "../../lib/skins/hash";
import { clockText, sameDay, withoutPartLabel } from "./spaces";

export interface Member {
  id: string;
  name: string;
  // Avatar colour 1–8; 0 is "you".
  tone: number;
}

// Generic given names, nobody in particular.
export const MEMBERS: Member[] = [
  { id: "lan-anh", name: "Lan Anh", tone: 1 },
  { id: "minh-tuan", name: "Minh Tuấn", tone: 2 },
  { id: "thu-ha", name: "Thu Hà", tone: 3 },
  { id: "quoc-bao", name: "Quốc Bảo", tone: 4 },
  { id: "hai-yen", name: "Hải Yến", tone: 5 },
  { id: "duc-long", name: "Đức Long", tone: 6 },
  { id: "phuong-trang", name: "Phương Trang", tone: 7 },
  { id: "dang-khoa", name: "Đăng Khoa", tone: 8 },
];

export const YOU: Member = { id: "you", name: "You", tone: 0 };

export interface ChatMessage {
  // The chapter line it shows, for the reading position.
  line: number;
  kind: "text" | "media";
  text: string;
}

export type ConversationItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "heading"; key: string; line: number; text: string }
  | { kind: "group"; key: string; member: Member; time: string; messages: ChatMessage[] };

// mulberry32: a small seeded generator, enough for picking names and minutes.
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Four colleagues per space, picked from the list by the space's id.
export function castFor(spaceKey: string, size = 4): Member[] {
  const random = seeded(hashString(`cast:${spaceKey}`));
  const pool = MEMBERS.slice();
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, Math.min(size, pool.length));
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// The day a thread happened: `workdaysAgo` working days before today (weekends skipped),
// so the newest thread is today's and the older ones run back through the weeks.
export function threadDate(today: Date, workdaysAgo: number): Date {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let left = Math.max(0, Math.floor(workdaysAgo));
  // Whole weeks at once, so a thread from years back costs nothing.
  const weeks = Math.floor(left / 5);
  date.setDate(date.getDate() - weeks * 7);
  left -= weeks * 5;
  while (left > 0) {
    date.setDate(date.getDate() - 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return date;
}

export function dayLabel(date: Date, today: Date): string {
  if (sameDay(date, today)) return "Today";
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  const base = `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === today.getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

// A line that is the chapter's title written out: the title itself, or a short line
// opening with a part label ("Chương 3: Gặp lại").
function isTitleText(text: string, title: string): boolean {
  const clean = text.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 120) return false;
  const name = title.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name && clean.toLowerCase() === name.toLowerCase()) return true;
  return withoutPartLabel(clean) !== clean;
}

/**
 * What a thread shows of a chapter, with or without neutral names: the chapter's own
 * title is left out — the leading heading (unless `titleDropped`: neutral names already
 * took it, lib/skins/chapterLines.ts) and a title line written out under it — other
 * headings lose a leading part label, and a line that was nothing but one goes.
 */
export function threadLines(
  lines: ChapterLine[],
  options: { title: string; titleDropped: boolean }
): ChapterLine[] {
  let start = !options.titleDropped && lines[0]?.kind === "heading" ? 1 : 0;
  const limit = start + 2;
  while (start < Math.min(limit, lines.length) && lines[start].kind === "text" && isTitleText(lines[start].text, options.title))
    start++;
  const out: ChapterLine[] = [];
  for (const line of lines.slice(start)) {
    if (line.kind === "media") {
      out.push(line);
      continue;
    }
    const rest = withoutPartLabel(line.text);
    if (!rest) continue;
    out.push(line.kind === "heading" && rest !== line.text ? { ...line, text: rest } : line);
  }
  return out;
}

// Office hours: the first message lands between 8:30 and 9:10, the last before 17:50.
const DAY_START = 8 * 60 + 30;
const DAY_END = 17 * 60 + 50;

/**
 * The thread's items. Runs of one to three messages share a sender, and a sender never
 * follows themself (that would be one group). Minutes are spread over the working day by
 * how many groups there are, so a long chapter still ends before the evening.
 */
export function buildConversation(
  lines: ChapterLine[],
  options: { spaceKey: string; order: number; date: Date; today: Date }
): ConversationItem[] {
  const random = seeded(hashString(`${options.spaceKey}:${options.order}`));
  const cast = castFor(options.spaceKey);
  const items: ConversationItem[] = [{ kind: "day", key: "day", label: dayLabel(options.date, options.today) }];

  const messageLines = lines.filter((line) => line.kind !== "heading").length;
  const groupsExpected = Math.max(1, Math.ceil(messageLines / 2));
  const start = DAY_START + Math.floor(random() * 40);
  const span = Math.min(groupsExpected * 3, DAY_END - start);

  let group: Extract<ConversationItem, { kind: "group" }> | null = null;
  let left = 0;
  let previous: Member | null = null;
  let groupIndex = 0;
  let minute = start;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.kind === "heading") {
      items.push({ kind: "heading", key: `h${index}`, line: index, text: line.text });
      // A divider ends a run, as a date divider does in the chat.
      group = null;
      continue;
    }
    if (!group || left === 0) {
      const choices = cast.length > 1 ? cast.filter((member) => member !== previous) : cast;
      const member = choices[Math.floor(random() * choices.length)];
      const planned = start + Math.round((groupIndex * span) / groupsExpected) + Math.floor(random() * 2);
      minute = Math.min(DAY_END, Math.max(minute, planned));
      group = { kind: "group", key: `g${index}`, member, time: clockText(minute), messages: [] };
      items.push(group);
      previous = member;
      left = 1 + Math.floor(random() * 3);
      groupIndex++;
    }
    group.messages.push({ line: index, kind: line.kind === "media" ? "media" : "text", text: line.text });
    left--;
  }
  return items;
}
