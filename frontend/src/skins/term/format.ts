// How the terminal's programs print: ls in columns and in long form, the sync progress
// bar, the login banner. Pure, so the exact text is tested.
import { displayWidth } from "./text";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SIX_MONTHS_MS = 182 * 24 * 3600 * 1000;

const two = (value: number) => String(value).padStart(2, "0");

/** ls's date column: "Oct  6 14:02" within six months, "Oct  6  2025" for older ones. */
export function lsDate(iso: string | undefined, now: Date): string {
  const date = iso ? new Date(iso) : now;
  const when = Number.isNaN(date.getTime()) ? now : date;
  const day = String(when.getDate()).padStart(2, " ");
  const recent = Math.abs(now.getTime() - when.getTime()) < SIX_MONTHS_MS;
  const tail = recent ? `${two(when.getHours())}:${two(when.getMinutes())}` : ` ${when.getFullYear()}`;
  return `${MONTHS[when.getMonth()]} ${day} ${tail}`;
}

// "Last login: Mon Oct  6 09:12:44 on ttys001", as a new terminal session opens.
export function lastLogin(at: Date): string {
  const day = String(at.getDate()).padStart(2, " ");
  const time = `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`;
  return `Last login: ${DAYS[at.getDay()]} ${MONTHS[at.getMonth()]} ${day} ${time} on ttys001`;
}

// When the decoy's session began: this morning at 08:47:12, or an hour ago when the
// screen is up earlier than that — dated from today, as the shell's own banner is.
export function morningLogin(now: Date): Date {
  const morning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 47, 12);
  return morning.getTime() <= now.getTime() ? morning : new Date(now.getTime() - 3600 * 1000);
}

// The `date` command, in the C locale's format.
export function dateLine(at: Date): string {
  const day = String(at.getDate()).padStart(2, " ");
  const time = `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`;
  const offset = -at.getTimezoneOffset();
  const zone = `${offset >= 0 ? "+" : "-"}${two(Math.floor(Math.abs(offset) / 60))}${two(Math.abs(offset) % 60)}`;
  return `${DAYS[at.getDay()]} ${MONTHS[at.getMonth()]} ${day} ${time} ${zone} ${at.getFullYear()}`;
}

// ls -h sizes: 512, 1.2K, 18K, 3.4M.
export function humanSize(bytes: number): string {
  const units = ["B", "K", "M", "G"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${bytes}B`;
  return value < 10 ? `${value.toFixed(1)}${units[unit]}` : `${Math.round(value)}${units[unit]}`;
}

/**
 * The size shown for a downloaded file nobody has opened yet (its text is not loaded):
 * steady for the same file, in the range a chapter really takes. Opened files show their
 * real size.
 */
export function estimatedSize(storyId: string, order: number): number {
  let hash = 2166136261;
  for (const char of `${storyId}:${order}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 9000 + ((hash >>> 0) % 17000);
}

/** `[########------------] 12/150`: a bar `width` cells wide and the count after it. */
export function progressBar(done: number, total: number, width = 30): string {
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const filled = Math.round(ratio * width);
  const pct = Math.floor(ratio * 100);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${done}/${total} ${String(pct).padStart(3, " ")}%`;
}

export type NameTone = "dir" | "file" | "pending" | "error";

export interface LsItem {
  name: string;
  tone: NameTone;
  size: number;
  // Links: a folder's entries + 2, a file 1.
  links: number;
  date: string | undefined;
}

export interface LsRow {
  meta: string;
  name: string;
  tone: NameTone;
}

/** ls -l: "total N" (512-byte blocks), then one row per entry with its columns aligned. */
export function lsLong(items: LsItem[], now: Date, human: boolean): { total: string; rows: LsRow[] } {
  const blocks = items.reduce((sum, item) => sum + Math.ceil(item.size / 4096) * 8, 0);
  const sizes = items.map((item) => (human ? humanSize(item.size) : String(item.size)));
  const links = items.map((item) => String(item.links));
  const sizeWidth = Math.max(0, ...sizes.map((size) => size.length));
  const linkWidth = Math.max(0, ...links.map((link) => link.length));
  const rows = items.map((item, index) => {
    const mode = item.tone === "dir" ? "drwxr-xr-x" : "-rw-r--r--";
    const meta = `${mode}  ${links[index].padStart(linkWidth)} dev  staff  ${sizes[index].padStart(sizeWidth)} ${lsDate(item.date, now)}`;
    return { meta, name: item.name, tone: item.tone };
  });
  return { total: `total ${blocks}`, rows };
}

export interface GridCell {
  name: string;
  tone: NameTone;
  // Spaces after the name, up to the next column.
  pad: number;
}

/**
 * ls's column layout: names down then across, as many columns as fit `columns` cells
 * with two spaces between them, each column as wide as its longest name.
 */
export function lsGrid(entries: { name: string; tone: NameTone }[], columns: number): GridCell[][] {
  if (entries.length === 0) return [];
  const widths = entries.map((entry) => displayWidth(entry.name));
  const gap = 2;
  let best = 1;
  for (let cols = Math.min(entries.length, Math.max(1, Math.floor(columns / 3))); cols > 1; cols--) {
    const rows = Math.ceil(entries.length / cols);
    let total = 0;
    for (let col = 0; col < cols; col++) {
      const slice = widths.slice(col * rows, col * rows + rows);
      if (slice.length === 0) continue;
      total += Math.max(...slice) + (col < cols - 1 ? gap : 0);
    }
    if (total <= columns) {
      best = cols;
      break;
    }
  }
  const rows = Math.ceil(entries.length / best);
  const colWidths = Array.from({ length: best }, (_, col) => Math.max(0, ...widths.slice(col * rows, col * rows + rows)));
  const grid: GridCell[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: GridCell[] = [];
    for (let col = 0; col < best; col++) {
      const index = col * rows + row;
      if (index >= entries.length) break;
      const last = col === best - 1 || (col + 1) * rows + row >= entries.length;
      line.push({ ...entries[index], pad: last ? 0 : colWidths[col] - widths[index] + gap });
    }
    grid.push(line);
  }
  return grid;
}

// `wc`: lines, words and bytes right-aligned in 8-cell columns, then the name.
export function wcLine(counts: { lines: number; words: number; bytes: number }, name: string): string {
  const cell = (value: number) => String(value).padStart(8, " ");
  return `${cell(counts.lines)}${cell(counts.words)}${cell(counts.bytes)} ${name}`;
}

// Time left as a download tool prints it: 45s, 3m12s, 1h05m.
export function etaText(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${two(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h${two(minutes % 60)}m`;
}
