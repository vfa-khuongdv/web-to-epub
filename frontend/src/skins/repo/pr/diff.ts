// A pull request's changes as the site draws them: unified-diff hunks numbered the way
// the site numbers them (old and new line per row), the same hunks paired side by side
// for the split view, the five-block diffstat, and the changed files as a folder tree.
// Pure, so the fake diffs stay consistent whatever text they are given.

export type LineKind = "add" | "del" | "context";

export interface DiffLine {
  kind: LineKind;
  old: number | null;
  new: number | null;
  text: string;
}

export interface Hunk {
  // The whole "@@ -a,b +c,d @@ section" line.
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Reads a patch — "@@" headers followed by lines that start with "+", "-" or a space —
 * into numbered hunks. A line with no sign (an empty line in a template string) is
 * context; "\ No newline at end of file" is skipped. Lines before the first header open
 * a hunk at line 1.
 */
export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let oldLine = 1;
  let newLine = 1;
  for (const raw of patch.split("\n")) {
    const match = HUNK_HEADER.exec(raw);
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      current = { header: raw, oldStart: oldLine, newStart: newLine, lines: [] };
      hunks.push(current);
      continue;
    }
    if (raw.startsWith("\\")) continue;
    if (!current) {
      current = { header: "@@ -1 +1 @@", oldStart: 1, newStart: 1, lines: [] };
      hunks.push(current);
    }
    const sign = raw[0];
    const text = raw.slice(1);
    if (sign === "+") current.lines.push({ kind: "add", old: null, new: newLine++, text });
    else if (sign === "-") current.lines.push({ kind: "del", old: oldLine++, new: null, text });
    else current.lines.push({ kind: "context", old: oldLine++, new: newLine++, text: sign === " " ? text : raw });
  }
  return hunks;
}

export interface HunkSpec {
  // The first old line the hunk shows (0 for a new file).
  at: number;
  // What follows the second "@@": the enclosing class or function.
  section?: string;
  // Patch lines: "+added", "-removed", " kept" (an empty line is a kept blank line).
  lines: string[];
}

/**
 * Hunks from their lines alone, with the "@@ -a,b +c,d @@" headers worked out: the
 * counts from the lines, and each new start shifted by what the hunks before it added
 * and removed — so a hand-written fake diff cannot carry a wrong header.
 */
export function hunksFrom(specs: HunkSpec[]): Hunk[] {
  let shift = 0;
  const patch: string[] = [];
  for (const spec of specs) {
    let additions = 0;
    let deletions = 0;
    for (const line of spec.lines) {
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }
    const oldCount = spec.lines.length - additions;
    const newCount = spec.lines.length - deletions;
    const newStart = spec.at === 0 ? (newCount > 0 ? 1 : 0) : spec.at + shift;
    patch.push(`@@ -${spec.at},${oldCount} +${newStart},${newCount} @@${spec.section ? ` ${spec.section}` : ""}`, ...spec.lines);
    shift += additions - deletions;
  }
  return parsePatch(patch.join("\n"));
}

// A whole new file: every line added, in one hunk.
export function addedHunks(lines: string[]): Hunk[] {
  if (lines.length === 0) return [];
  return [
    {
      header: `@@ -0,0 +1,${lines.length} @@`,
      oldStart: 0,
      newStart: 1,
      lines: lines.map((text, index) => ({ kind: "add", old: null, new: index + 1, text })),
    },
  ];
}

export function changeCounts(hunks: Hunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks)
    for (const line of hunk.lines) {
      if (line.kind === "add") additions++;
      else if (line.kind === "del") deletions++;
    }
  return { additions, deletions };
}

export type Block = "add" | "del" | "neutral";

/**
 * The five little squares beside "+12 −3": green and red in proportion to what changed,
 * grey for the rest when fewer than five lines changed at all.
 */
export function diffstatBlocks(additions: number, deletions: number, count = 5): Block[] {
  const total = additions + deletions;
  if (total === 0) return Array<Block>(count).fill("neutral");
  if (total < count) {
    return [...Array<Block>(additions).fill("add"), ...Array<Block>(deletions).fill("del"), ...Array<Block>(count - total).fill("neutral")];
  }
  let green = Math.round((additions / total) * count);
  if (additions > 0 && green === 0) green = 1;
  if (deletions > 0 && green === count) green = count - 1;
  return [...Array<Block>(green).fill("add"), ...Array<Block>(count - green).fill("del")];
}

// ---- Rows ------------------------------------------------------------------------------

export type UnifiedRow = { kind: "hunk"; header: string; index: number } | { kind: "line"; line: DiffLine };

export function unifiedRows(hunks: Hunk[]): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  hunks.forEach((hunk, index) => {
    rows.push({ kind: "hunk", header: hunk.header, index });
    for (const line of hunk.lines) rows.push({ kind: "line", line });
  });
  return rows;
}

export type SplitRow =
  | { kind: "hunk"; header: string; index: number }
  | { kind: "pair"; left: DiffLine | null; right: DiffLine | null };

/**
 * The split view: kept lines on both sides, and each run of removed lines paired row by
 * row with the run of added lines after it — the longer run leaves blanks on the other
 * side, as the site leaves them.
 */
export function splitRows(hunks: Hunk[]): SplitRow[] {
  const rows: SplitRow[] = [];
  hunks.forEach((hunk, index) => {
    rows.push({ kind: "hunk", header: hunk.header, index });
    const lines = hunk.lines;
    let at = 0;
    while (at < lines.length) {
      const line = lines[at];
      if (line.kind === "context") {
        rows.push({ kind: "pair", left: line, right: line });
        at++;
        continue;
      }
      const removed: DiffLine[] = [];
      const added: DiffLine[] = [];
      while (at < lines.length && lines[at].kind === "del") removed.push(lines[at++]);
      while (at < lines.length && lines[at].kind === "add") added.push(lines[at++]);
      for (let pair = 0; pair < Math.max(removed.length, added.length); pair++) {
        rows.push({ kind: "pair", left: removed[pair] ?? null, right: added[pair] ?? null });
      }
    }
  });
  return rows;
}

// Where a comment on this line hangs: a removed line on the old side, anything else on
// the new one.
export function lineSide(line: DiffLine): { side: "L" | "R"; line: number } {
  return line.kind === "del" ? { side: "L", line: line.old ?? 0 } : { side: "R", line: line.new ?? 0 };
}

export function lineKey(side: "L" | "R", line: number): string {
  return `${side}${line}`;
}

/**
 * The few diff lines a review comment quotes in the conversation: the commented line and
 * up to `count - 1` lines before it in the same hunk.
 */
export function quotedLines(hunks: Hunk[], side: "L" | "R", line: number, count = 4): DiffLine[] {
  for (const hunk of hunks) {
    const index = hunk.lines.findIndex((candidate) => (side === "L" ? candidate.kind === "del" && candidate.old === line : candidate.kind !== "del" && candidate.new === line));
    if (index >= 0) return hunk.lines.slice(Math.max(0, index - count + 1), index + 1);
  }
  return [];
}

// ---- The file tree -----------------------------------------------------------------------

export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string };

interface DraftDir {
  dirs: Map<string, DraftDir>;
  files: string[];
}

/**
 * The changed files as the site's file tree: folders first, then files, each by name; a
 * folder holding only one folder is drawn as one row ("src/budget"), as the site does.
 */
export function buildTree(paths: string[]): TreeNode[] {
  const root: DraftDir = { dirs: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    dir.files.push(parts[parts.length - 1]);
  }
  const build = (dir: DraftDir, prefix: string): TreeNode[] => {
    const nodes: TreeNode[] = [];
    for (const name of [...dir.dirs.keys()].sort(compareNames)) {
      let child = dir.dirs.get(name)!;
      let label = name;
      while (child.files.length === 0 && child.dirs.size === 1) {
        const [only, inner] = [...child.dirs.entries()][0];
        label = `${label}/${only}`;
        child = inner;
      }
      const path = prefix ? `${prefix}/${label}` : label;
      nodes.push({ kind: "dir", name: label, path, children: build(child, path) });
    }
    for (const name of [...dir.files].sort(compareNames)) {
      nodes.push({ kind: "file", name, path: prefix ? `${prefix}/${name}` : name });
    }
    return nodes;
  };
  return build(root, "");
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
}

// The files in the order the tree shows them, which is the order the diffs are drawn in.
export function treeFiles(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.kind === "file") out.push(node.path);
      else walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

// The tree with only the files whose path contains `query` (any case), and the folders
// that still hold one.
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return nodes;
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === "file") {
      if (node.path.toLowerCase().includes(wanted)) out.push(node);
    } else {
      const children = filterTree(node.children, wanted);
      if (children.length > 0) out.push({ ...node, children });
    }
  }
  return out;
}
