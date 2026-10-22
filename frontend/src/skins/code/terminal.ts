// The terminal panel: the crawl log of the open folder printed like a process's output,
// with a prompt for a handful of commands. Pure parts — parsing, the log rewrite that
// keeps story URLs off the screen, and how typed commands interleave with the log.
import { CrawlLogLine } from "../../hooks/useCrawlJob";

export type TerminalCommand = "help" | "crawl" | "stop" | "open" | "clear" | "hide" | "empty" | "unknown";

const COMMANDS: Record<string, TerminalCommand> = {
  help: "help",
  crawl: "crawl",
  stop: "stop",
  open: "open",
  clear: "clear",
  cls: "clear",
  hide: "hide",
};

export const COMMAND_NAMES = ["help", "crawl", "stop", "open", "clear", "hide"] as const;

export function parseCommand(input: string): { command: TerminalCommand; name: string } {
  const name = input.trim().split(/\s+/)[0] ?? "";
  if (!name) return { command: "empty", name: "" };
  return { command: COMMANDS[name.toLowerCase()] ?? "unknown", name };
}

export interface TerminalEntry {
  id: number;
  kind: "input" | "output" | "error";
  text: string;
  // The last log line printed when this entry was written; it prints after that line.
  after: CrawlLogLine | null;
}

export type TerminalItem = { type: "log"; line: CrawlLogLine; index: number } | { type: "entry"; entry: TerminalEntry };

/**
 * The terminal's lines in the order they happened: log lines, with each typed command
 * (and its answer) after the log line that was last when it was typed. `clearedAt` is the
 * last log line when `clear` ran (null: the log was empty then; undefined: never
 * cleared) — lines up to it stay hidden. Lines are matched by identity; when the log was
 * reset (another folder) or trimmed past the mark, everything left is shown.
 */
export function interleave(
  log: CrawlLogLine[],
  entries: TerminalEntry[],
  clearedAt: CrawlLogLine | null | undefined
): TerminalItem[] {
  const markIndex = clearedAt ? log.indexOf(clearedAt) : -1;
  const start = markIndex + 1;
  const byAnchor = new Map<number, TerminalEntry[]>();
  const head: TerminalEntry[] = [];
  for (const entry of entries) {
    const at = entry.after ? log.indexOf(entry.after) : -1;
    if (at < start) head.push(entry);
    else byAnchor.set(at, [...(byAnchor.get(at) ?? []), entry]);
  }
  const items: TerminalItem[] = head.map((entry) => ({ type: "entry", entry }));
  for (let index = start; index < log.length; index++) {
    items.push({ type: "log", line: log[index], index });
    for (const entry of byAnchor.get(index) ?? []) items.push({ type: "entry", entry });
  }
  return items;
}

// Up/Down in the prompt walk back through what was typed, like a shell's history.
export function historyStep(history: string[], position: number, step: -1 | 1): number {
  return Math.min(history.length, Math.max(0, position + step));
}
