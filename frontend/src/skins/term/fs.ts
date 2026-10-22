// The terminal's file system: a home folder with `projects/` in it, one folder per story
// in there, one Markdown file per chapter in each. Names come from lib/skins/slug.ts
// (titles as ASCII slugs, or module-01/part-0001.md with neutral names on). Pure: the
// shell hands in what it has loaded through an FsView.

export type DirNode =
  | { kind: "home" }
  | { kind: "library" }
  // The usual empty folders of a home directory, for `ls ~` to look lived in.
  | { kind: "extra"; name: string }
  | { kind: "story"; storyId: string };

export type FsNode = DirNode | { kind: "file"; storyId: string; order: number };

export const HOME_DIRS = ["Desktop", "Documents", "Downloads"];
export const LIBRARY_DIR = "projects";
export const HOME: DirNode = { kind: "home" };
export const LIBRARY: DirNode = { kind: "library" };

export type FileState = "done" | "pending" | "running" | "error";

export interface FileEntry {
  order: number;
  name: string;
  state: FileState;
  error?: string;
}

export interface FsView {
  // A story's folder name, and the story a folder name belongs to.
  dirName: (storyId: string) => string | undefined;
  storyByName: (name: string) => string | undefined;
  // A story's files, or null while its chapter list is not loaded.
  files: (storyId: string) => FileEntry[] | null;
}

export type Resolved =
  | { ok: true; node: FsNode }
  | { ok: false; reason: "missing" | "notdir" }
  // The path goes through a story whose chapter list is not loaded yet.
  | { ok: false; reason: "need"; storyId: string };

// Two stories can slug to the same name; the later ones get -2, -3… as a file manager does.
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  const taken = new Set(names);
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count === 1) return name;
    let suffix = count;
    while (taken.has(`${name}-${suffix}`)) suffix++;
    const unique = `${name}-${suffix}`;
    taken.add(unique);
    return unique;
  });
}

export function sameDir(a: DirNode, b: DirNode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "story" && b.kind === "story") return a.storyId === b.storyId;
  if (a.kind === "extra" && b.kind === "extra") return a.name === b.name;
  return true;
}

export function parentOf(dir: FsNode): DirNode {
  switch (dir.kind) {
    case "file":
      return { kind: "story", storyId: dir.storyId };
    case "story":
      return LIBRARY;
    default:
      // ~/.. is above the home folder; the shell keeps everyone at home.
      return HOME;
  }
}

function child(dir: DirNode, name: string, view: FsView): Resolved {
  switch (dir.kind) {
    case "home":
      if (name === LIBRARY_DIR) return { ok: true, node: LIBRARY };
      if (HOME_DIRS.includes(name)) return { ok: true, node: { kind: "extra", name } };
      return { ok: false, reason: "missing" };
    case "library": {
      const storyId = view.storyByName(name);
      return storyId ? { ok: true, node: { kind: "story", storyId } } : { ok: false, reason: "missing" };
    }
    case "extra":
      return { ok: false, reason: "missing" };
    case "story": {
      const files = view.files(dir.storyId);
      if (!files) return { ok: false, reason: "need", storyId: dir.storyId };
      const file = files.find((entry) => entry.name === name);
      return file ? { ok: true, node: { kind: "file", storyId: dir.storyId, order: file.order } } : { ok: false, reason: "missing" };
    }
  }
}

// /Users/dev/… and /home/dev/… are the home folder written out.
const HOME_PREFIX = /^\/(?:Users|home)\/dev(?=\/|$)/;

/** A path typed at the prompt (relative, ~/…, or the home folder written out), resolved. */
export function resolvePath(cwd: DirNode, path: string, view: FsView): Resolved {
  let rest = path;
  let node: FsNode = cwd;
  if (rest === "~" || rest.startsWith("~/")) {
    node = HOME;
    rest = rest.slice(1);
  } else if (rest.startsWith("/")) {
    if (!HOME_PREFIX.test(rest)) return { ok: false, reason: "missing" };
    node = HOME;
    rest = rest.replace(HOME_PREFIX, "");
  }
  const trailingSlash = rest.endsWith("/");
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (node.kind === "file") return { ok: false, reason: "notdir" };
    if (segment === "..") {
      node = parentOf(node);
      continue;
    }
    const next = child(node, segment, view);
    if (!next.ok) return next;
    node = next.node;
  }
  if (trailingSlash && node.kind === "file") return { ok: false, reason: "notdir" };
  return { ok: true, node };
}

// How a folder is written in the prompt and the title: ~, ~/projects, ~/projects/name.
export function dirPath(dir: DirNode, view: Pick<FsView, "dirName">): string {
  switch (dir.kind) {
    case "home":
      return "~";
    case "library":
      return `~/${LIBRARY_DIR}`;
    case "extra":
      return `~/${dir.name}`;
    case "story":
      return `~/${LIBRARY_DIR}/${view.dirName(dir.storyId) ?? "?"}`;
  }
}

// The last part of a folder's path, as the window title shows it.
export function dirBase(dir: DirNode, view: Pick<FsView, "dirName">): string {
  const path = dirPath(dir, view);
  return path === "~" ? "~" : path.slice(path.lastIndexOf("/") + 1);
}

export interface DirEntry {
  name: string;
  dir: boolean;
  node: FsNode;
}

/** What is in a folder, sorted by name as ls sorts; null while a story's list loads. */
export function listDir(dir: DirNode, view: FsView, storyIds: string[]): DirEntry[] | null {
  switch (dir.kind) {
    case "home":
      return [...HOME_DIRS, LIBRARY_DIR]
        .map((name): DirEntry => ({
          name,
          dir: true,
          node: name === LIBRARY_DIR ? LIBRARY : { kind: "extra", name },
        }))
        .sort((a, b) => compareNames(a.name, b.name));
    case "library":
      return storyIds
        .map((storyId): DirEntry => ({ name: view.dirName(storyId) ?? storyId, dir: true, node: { kind: "story", storyId } }))
        .sort((a, b) => compareNames(a.name, b.name));
    case "extra":
      return [];
    case "story": {
      const files = view.files(dir.storyId);
      if (!files) return null;
      // Zero-padded numbers already sort by name; by order also past part-9999.
      return [...files]
        .sort((a, b) => a.order - b.order)
        .map((file): DirEntry => ({ name: file.name, dir: false, node: { kind: "file", storyId: dir.storyId, order: file.order } }));
    }
  }
}

// ls's order in a UTF-8 locale: case folded, then as written.
export function compareNames(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// A chapter's state as a file: the stored status, or what the running download says.
export function chapterState(
  chapter: { status: "done" | "pending" | "error"; url: string },
  overlay?: Record<string, "running" | "done" | "error">
): FileState {
  if (chapter.status !== "pending") return chapter.status;
  return overlay?.[chapter.url] ?? "pending";
}

export type Adjacent =
  | { ok: true; order: number; at: number; of: number }
  // Nothing readable that way: files not downloaded yet, or the end of the folder.
  | { ok: false; reason: "pending" | "end" };

/** The next (or previous) readable file from `order`, as less's :n / :p step through. */
export function adjacentFile(files: FileEntry[], order: number, direction: 1 | -1): Adjacent {
  const sorted = [...files].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((file) => file.order === order);
  let pending = false;
  for (let at = (from < 0 ? (direction === 1 ? -1 : sorted.length) : from) + direction; at >= 0 && at < sorted.length; at += direction) {
    const file = sorted[at];
    if (file.state === "done") return { ok: true, order: file.order, at: at + 1, of: sorted.length };
    if (file.state !== "error") pending = true;
  }
  return { ok: false, reason: pending ? "pending" : "end" };
}

// Where `less` with no file opens in a folder: the file read last, else the first one
// downloaded; null when nothing in it can be read yet.
export function resumeFile(files: FileEntry[], saved: { order: number; line: number } | null): { order: number; line: number } | null {
  const last = saved ? files.find((file) => file.order === saved.order && file.state === "done") : undefined;
  if (last && saved) return { order: last.order, line: saved.line };
  const first = [...files].sort((a, b) => a.order - b.order).find((file) => file.state === "done");
  return first ? { order: first.order, line: 0 } : null;
}
