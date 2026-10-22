// What each command typed at the prompt does, decided without side effects: the shell
// (TermShell) runs the plan — prints, changes folder, fetches a file, starts a download.
// Messages that imitate the tools (ls, cd, cat, zsh) are their literal text; anything
// that tells the user what the app does goes through t().
import { Translate } from "../../i18n";
import { stripUrls } from "../../lib/skins/crawlLog";
import { GridCell, LsItem, LsRow, NameTone, dateLine, lsGrid, lsLong } from "./format";
import { DirNode, FileEntry, FsNode, FsView, HOME, HOME_DIRS, LIBRARY, dirPath, listDir, resolvePath } from "./fs";
import { ParsedLine, readOptions } from "./shellParse";

export const COMMAND_NAMES = [
  "cat",
  "cd",
  "clear",
  "date",
  "echo",
  "exit",
  "head",
  "help",
  "hide",
  "history",
  "hostname",
  "less",
  "ll",
  "ls",
  "more",
  "open",
  "pwd",
  "settings",
  "stop",
  "sync",
  "tail",
  "wc",
  "whoami",
];

export const USER = "dev";
export const HOST = "workstation";
const HOME_PATH = `/Users/${USER}`;

export type OutLine =
  | { kind: "text"; text: string; tone?: "error" | "dim" | "accent" }
  | { kind: "grid"; cells: GridCell[] }
  | { kind: "long"; row: LsRow };

export interface FileTarget {
  storyId: string;
  order: number;
  name: string;
}

export type Plan =
  | { type: "print"; lines: OutLine[] }
  | { type: "cd"; to: DirNode }
  // Fetch the files' text, then print all of it, its first/last `count` lines, or counts.
  | { type: "read"; mode: "cat" | "head" | "tail" | "wc"; files: FileTarget[]; count: number; before: OutLine[] }
  // The pager on a file; null: where the reader left off in the current folder.
  | { type: "pager"; file: FileTarget | null }
  | { type: "sync"; storyId: string; background: boolean }
  | { type: "stop"; storyId: string }
  | { type: "open"; storyId?: string; order?: number }
  | { type: "settings" }
  | { type: "clear" }
  | { type: "exit" }
  | { type: "hide" }
  | { type: "history" }
  // A path goes through a folder whose file list is not loaded: load it, then plan again.
  | { type: "need"; storyId: string }
  | { type: "none" };

export interface PlanContext {
  cwd: DirNode;
  // The folder before the last cd, for `cd -`.
  previous: DirNode | null;
  view: FsView;
  storyIds: string[];
  columns: number;
  now: Date;
  crawling: (storyId: string) => boolean;
  // A file's size in bytes (its real size once opened), a story's last change.
  sizeOf: (storyId: string, file: FileEntry) => number;
  storyDate: (storyId: string) => string | undefined;
  // How many files a folder holds while its list is not loaded (the library's count).
  fileCount?: (storyId: string) => number;
}

const text = (value: string, tone?: "error" | "dim" | "accent"): OutLine => ({ kind: "text", text: value, tone });
const error = (value: string): OutLine => text(value, "error");
const print = (...lines: OutLine[]): Plan => ({ type: "print", lines });

// The absolute path, as pwd prints it.
export function absolutePath(dir: DirNode, view: Pick<FsView, "dirName">): string {
  return dirPath(dir, view).replace(/^~/, HOME_PATH);
}

function toneOf(file: FileEntry): NameTone {
  if (file.state === "done") return "file";
  return file.state === "error" ? "error" : "pending";
}

function fileOf(node: FsNode, view: FsView): FileEntry | null {
  if (node.kind !== "file") return null;
  return view.files(node.storyId)?.find((file) => file.order === node.order) ?? null;
}

// The ls -l details of a folder or file.
function lsItem(name: string, node: FsNode, ctx: PlanContext): LsItem {
  const { view } = ctx;
  if (node.kind === "file") {
    const file = fileOf(node, view);
    return {
      name,
      tone: file ? toneOf(file) : "file",
      size: file ? ctx.sizeOf(node.storyId, file) : 0,
      links: 1,
      date: ctx.storyDate(node.storyId),
    };
  }
  let count = 0;
  let date: string | undefined;
  if (node.kind === "story") {
    count = view.files(node.storyId)?.length ?? ctx.fileCount?.(node.storyId) ?? 0;
    date = ctx.storyDate(node.storyId);
  } else if (node.kind === "library") {
    count = ctx.storyIds.length;
    date = ctx.storyIds.map((id) => ctx.storyDate(id) ?? "").sort().pop() || undefined;
  } else if (node.kind === "home") {
    count = HOME_DIRS.length + 1;
  }
  return { name, tone: "dir", size: 64 + 32 * count, links: count + 2, date };
}

function lsFlagsError(flag: string): Plan {
  return print(error(`ls: invalid option -- '${flag}'`), text("usage: ls [-1ahlrt] [file ...]"));
}

function listing(operand: string, node: FsNode, flags: Set<string>, ctx: PlanContext): Plan | OutLine[] {
  const long = flags.has("l");
  if (node.kind === "file") {
    const item = lsItem(operand, node, ctx);
    return long ? [{ kind: "long", row: lsLong([item], ctx.now, flags.has("h")).rows[0] }] : [{ kind: "grid", cells: [{ name: operand, tone: item.tone, pad: 0 }] }];
  }
  const entries = listDir(node, ctx.view, ctx.storyIds);
  if (!entries) return { type: "need", storyId: (node as { storyId: string }).storyId };
  let items = entries.map((entry) => lsItem(entry.name, entry.node, ctx));
  if (flags.has("t")) {
    const dated = items.map((item, index) => ({ item, index }));
    dated.sort((a, b) => (b.item.date ?? "").localeCompare(a.item.date ?? "") || a.index - b.index);
    items = dated.map((entry) => entry.item);
  }
  if (flags.has("r")) items.reverse();
  if (flags.has("a")) {
    const parentNode: FsNode = node.kind === "story" ? LIBRARY : HOME;
    items = [lsItem(".", node, ctx), lsItem("..", parentNode, ctx), ...items];
  }
  if (long) {
    const { total, rows } = lsLong(items, ctx.now, flags.has("h"));
    return [text(total), ...rows.map((row): OutLine => ({ kind: "long", row }))];
  }
  const cells = items.map((item) => ({ name: item.name, tone: item.tone }));
  const grid = flags.has("1") ? cells.map((cell) => [{ ...cell, pad: 0 }]) : lsGrid(cells, ctx.columns);
  return grid.map((row): OutLine => ({ kind: "grid", cells: row }));
}

function ls(args: string[], ctx: PlanContext, extra = ""): Plan {
  const options = readOptions(extra ? [extra, ...args] : args, "1ahlrt");
  if (options.invalid) return lsFlagsError(options.invalid);
  const operands = options.operands.length > 0 ? options.operands : [""];
  const out: OutLine[] = [];
  const missing: OutLine[] = [];
  const many = operands.length > 1;
  for (const operand of operands) {
    const resolved = resolvePath(ctx.cwd, operand, ctx.view);
    if (!resolved.ok) {
      if (resolved.reason === "need") return { type: "need", storyId: resolved.storyId };
      missing.push(error(`ls: ${operand}: ${resolved.reason === "notdir" ? "Not a directory" : "No such file or directory"}`));
      continue;
    }
    const lines = listing(operand, resolved.node, options.flags, ctx);
    if (!Array.isArray(lines)) return lines;
    if (many && resolved.node.kind !== "file") {
      if (out.length > 0) out.push(text(""));
      out.push(text(`${operand}:`));
    }
    out.push(...lines);
  }
  return print(...missing, ...out);
}

function cd(args: string[], ctx: PlanContext): Plan {
  const target = args[0] ?? "~";
  if (args.length > 1) return print(error(`cd: string not in pwd: ${args[0]}`));
  if (target === "-") {
    if (!ctx.previous) return print(error("cd: no previous directory"));
    return { type: "cd", to: ctx.previous };
  }
  const resolved = resolvePath(ctx.cwd, target, ctx.view);
  if (!resolved.ok) {
    if (resolved.reason === "need") return { type: "need", storyId: resolved.storyId };
    return print(error(`cd: ${resolved.reason === "notdir" ? "not a directory" : "no such file or directory"}: ${target}`));
  }
  if (resolved.node.kind === "file") return print(error(`cd: not a directory: ${target}`));
  return { type: "cd", to: resolved.node };
}

// Files the operands name, with the tool's error for each one that cannot be read.
function readable(
  tool: string,
  operands: string[],
  ctx: PlanContext,
  t: Translate
): { files: FileTarget[]; errors: OutLine[] } | { need: string } {
  const files: FileTarget[] = [];
  const errors: OutLine[] = [];
  for (const operand of operands) {
    const resolved = resolvePath(ctx.cwd, operand, ctx.view);
    if (!resolved.ok) {
      if (resolved.reason === "need") return { need: resolved.storyId };
      errors.push(error(`${tool}: ${operand}: ${resolved.reason === "notdir" ? "Not a directory" : "No such file or directory"}`));
      continue;
    }
    const file = fileOf(resolved.node, ctx.view);
    if (!file || resolved.node.kind !== "file") {
      errors.push(error(`${tool}: ${operand}: Is a directory`));
      continue;
    }
    const problem = fileProblem(file, t);
    if (problem) {
      errors.push(error(`${tool}: ${operand}: ${problem}`));
      continue;
    }
    files.push({ storyId: resolved.node.storyId, order: file.order, name: file.name });
  }
  return { files, errors };
}

// Why a file cannot be read yet, or null when it can.
export function fileProblem(file: FileEntry, t: Translate): string | null {
  if (file.state === "done") return null;
  if (file.state === "error") return t("Download failed: {message}", { message: stripUrls(file.error || "?") });
  return t("Not downloaded yet.");
}

function readCommand(tool: "cat" | "head" | "tail" | "wc", args: string[], ctx: PlanContext, t: Translate): Plan {
  const options =
    tool === "head" || tool === "tail" ? readOptions(args, "", "n") : tool === "wc" ? readOptions(args, "lwc") : readOptions(args, "nsuv");
  if (options.invalid) {
    return print(error(`${tool}: illegal option -- ${options.invalid}`), text(`usage: ${tool} ${tool === "cat" ? "[file ...]" : tool === "wc" ? "[-clw] [file ...]" : "[-n lines] [file ...]"}`));
  }
  let count = 10;
  if (options.values.n !== undefined) {
    count = Number(options.values.n);
    if (!Number.isInteger(count) || count < 0) return print(error(`${tool}: illegal line count -- ${options.values.n}`));
  }
  if (options.operands.length === 0) return print(error(`usage: ${tool} [file ...]`));
  const found = readable(tool, options.operands, ctx, t);
  if ("need" in found) return { type: "need", storyId: found.need };
  if (found.files.length === 0) return print(...found.errors);
  return { type: "read", mode: tool, files: found.files, count, before: found.errors };
}

function pagerCommand(tool: string, args: string[], ctx: PlanContext, t: Translate): Plan {
  const operands = args.filter((arg) => !arg.startsWith("-") || arg === "-");
  if (operands.length === 0) {
    // Our less picks up where the reader left off; outside a folder of files it is less.
    if (ctx.cwd.kind === "story") return { type: "pager", file: null };
    return print(error(`Missing filename ("${tool} --help" for help)`));
  }
  const operand = operands[0];
  const resolved = resolvePath(ctx.cwd, operand, ctx.view);
  if (!resolved.ok) {
    if (resolved.reason === "need") return { type: "need", storyId: resolved.storyId };
    return print(error(`${operand}: No such file or directory`));
  }
  const file = fileOf(resolved.node, ctx.view);
  if (!file || resolved.node.kind !== "file") return print(error(`${operand} is a directory`));
  const problem = fileProblem(file, t);
  if (problem) return print(error(`${operand}: ${problem}`));
  return { type: "pager", file: { storyId: resolved.node.storyId, order: file.order, name: file.name } };
}

// The story a command acts on: the folder given, or the one the shell is in.
function storyOf(tool: string, args: string[], ctx: PlanContext, t: Translate): { storyId: string } | Plan {
  const operand = args.find((arg) => !arg.startsWith("-"));
  if (operand) {
    const resolved = resolvePath(ctx.cwd, operand, ctx.view);
    if (!resolved.ok) {
      if (resolved.reason === "need") return { type: "need", storyId: resolved.storyId };
      return print(error(`${tool}: ${operand}: No such file or directory`));
    }
    const node = resolved.node;
    if (node.kind === "story" || node.kind === "file") return { storyId: node.storyId };
    return print(error(`${tool}: ${t("No folder is open.")}`));
  }
  if (ctx.cwd.kind === "story") return { storyId: ctx.cwd.storyId };
  return print(error(`${tool}: ${t("No folder is open.")}`));
}

function help(t: Translate): Plan {
  const rows: [string, string][] = [
    ["ls [-l] [dir]", t("List the files in a folder")],
    ["cd <dir>", t("Change folder (cd .. goes up, cd ~ goes home)")],
    ["less <file>", t("Read a file page by page (q to quit, h for keys)")],
    ["less", t("Pick up where you left off in this folder")],
    ["cat <file>", t("Print a whole file")],
    ["head|tail <file>", t("Print the first or last lines of a file")],
    ["sync [&]", t("Download the rest")],
    ["stop", t("Stop downloading")],
    ["open [file]", t("Open in the normal view")],
    ["settings", t("Settings")],
    ["history", t("Show what was typed in this session")],
    ["clear", t("Clear the terminal")],
    ["hide", t("Hide now")],
    ["exit", t("Close this session and start a new one")],
  ];
  const width = Math.max(...rows.map(([usage]) => usage.length)) + 3;
  return print(...rows.map(([usage, what]) => text(`  ${usage.padEnd(width)}${what}`)), text(""), text(t("Tab completes names, ↑ and ↓ walk through what you typed."), "dim"));
}

/** What a typed line does. `t` words the messages that describe the app. */
export function planCommand(line: ParsedLine, ctx: PlanContext, t: Translate): Plan {
  if (line.unclosed) return print(error(`zsh: unmatched ${line.unclosed}`));
  const { name, args } = line;
  switch (name) {
    case "":
      return { type: "none" };
    case "ls":
      return ls(args, ctx);
    case "ll":
      return ls(args, ctx, "-l");
    case "cd":
      return cd(args, ctx);
    case "pwd":
      return print(text(absolutePath(ctx.cwd, ctx.view)));
    case "cat":
    case "head":
    case "tail":
    case "wc":
      return readCommand(name, args, ctx, t);
    case "less":
    case "more":
      return pagerCommand(name, args, ctx, t);
    case "sync": {
      const target = storyOf("sync", args, ctx, t);
      if ("type" in target) return target;
      return { type: "sync", storyId: target.storyId, background: line.background };
    }
    case "stop": {
      const target = storyOf("stop", args, ctx, t);
      if ("type" in target) return target;
      if (!ctx.crawling(target.storyId)) return print(text(t("Nothing is downloading.")));
      return { type: "stop", storyId: target.storyId };
    }
    case "open": {
      if (args.length === 0) return ctx.cwd.kind === "story" ? { type: "open", storyId: ctx.cwd.storyId } : { type: "open" };
      const resolved = resolvePath(ctx.cwd, args[0], ctx.view);
      if (!resolved.ok) {
        if (resolved.reason === "need") return { type: "need", storyId: resolved.storyId };
        return print(error(`The file ${absolutePath(ctx.cwd, ctx.view)}/${args[0]} does not exist.`));
      }
      const node = resolved.node;
      if (node.kind === "file") return { type: "open", storyId: node.storyId, order: node.order };
      if (node.kind === "story") return { type: "open", storyId: node.storyId };
      return { type: "open" };
    }
    case "settings":
      return { type: "settings" };
    case "clear":
      return { type: "clear" };
    case "exit":
    case "logout":
      return { type: "exit" };
    case "hide":
      return { type: "hide" };
    case "history":
      return { type: "history" };
    case "help":
      return help(t);
    case "echo":
      return print(text(args.join(" ")));
    case "whoami":
      return print(text(USER));
    case "hostname":
      return print(text(HOST));
    case "date":
      return print(text(dateLine(ctx.now)));
    default:
      return print(error(`zsh: command not found: ${name}`));
  }
}

// `history`: zsh's numbered list.
export function historyLines(history: string[]): OutLine[] {
  return history.map((entry, index) => text(`${String(index + 1).padStart(5, " ")}  ${entry}`));
}
