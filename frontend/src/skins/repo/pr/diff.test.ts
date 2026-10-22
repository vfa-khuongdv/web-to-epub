import { describe, expect, it } from "vitest";
import {
  addedHunks,
  buildTree,
  changeCounts,
  diffstatBlocks,
  filterTree,
  hunksFrom,
  lineSide,
  parsePatch,
  quotedLines,
  splitRows,
  treeFiles,
  unifiedRows,
} from "./diff";

const PATCH = [
  "@@ -10,3 +10,4 @@ class A {",
  " keep",
  "-old",
  "+new one",
  "+new two",
  " tail",
  "@@ -40,2 +41,2 @@ class A {",
  "-a",
  "-b",
  "+c",
  "",
  "\\ No newline at end of file",
].join("\n");

describe("parsePatch", () => {
  it("numbers old and new lines from each hunk header", () => {
    const hunks = parsePatch(PATCH);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].lines.map((line) => [line.kind, line.old, line.new, line.text])).toEqual([
      ["context", 10, 10, "keep"],
      ["del", 11, null, "old"],
      ["add", null, 11, "new one"],
      ["add", null, 12, "new two"],
      ["context", 12, 13, "tail"],
    ]);
    // An unsigned empty line is context; the "no newline" marker is not a line.
    expect(hunks[1].lines.map((line) => [line.kind, line.old, line.new])).toEqual([
      ["del", 40, null],
      ["del", 41, null],
      ["add", null, 41],
      ["context", 42, 42],
    ]);
  });

  it("starts at line 1 without a header", () => {
    expect(parsePatch("+x")[0].lines[0]).toEqual({ kind: "add", old: null, new: 1, text: "x" });
  });

  it("counts what changed", () => {
    expect(changeCounts(parsePatch(PATCH))).toEqual({ additions: 3, deletions: 3 });
  });
});

describe("hunksFrom", () => {
  it("works out every header from the lines", () => {
    const hunks = hunksFrom([
      { at: 3, section: "class A {", lines: [" a", "-b", "+c", "+d", " e"] },
      { at: 20, lines: [" x", "-y", " z"] },
    ]);
    expect(hunks.map((hunk) => hunk.header)).toEqual(["@@ -3,3 +3,4 @@ class A {", "@@ -20,3 +21,2 @@"]);
    expect(hunks[1].lines[2]).toMatchObject({ old: 22, new: 22 });
  });

  it("starts a new file at line 1", () => {
    expect(hunksFrom([{ at: 0, lines: ["+a", "+b"] }])[0].header).toBe("@@ -0,0 +1,2 @@");
  });
});

describe("addedHunks", () => {
  it("adds a whole file as one hunk", () => {
    const [hunk] = addedHunks(["# Title", "", "Text"]);
    expect(hunk.header).toBe("@@ -0,0 +1,3 @@");
    expect(hunk.lines.map((line) => line.new)).toEqual([1, 2, 3]);
    expect(addedHunks([])).toEqual([]);
  });
});

describe("diffstatBlocks", () => {
  it("draws five blocks in proportion", () => {
    expect(diffstatBlocks(186, 42)).toEqual(["add", "add", "add", "add", "del"]);
    expect(diffstatBlocks(10, 0)).toEqual(["add", "add", "add", "add", "add"]);
    expect(diffstatBlocks(0, 9)).toEqual(["del", "del", "del", "del", "del"]);
  });

  it("keeps a block for a small side and grey for few changes", () => {
    expect(diffstatBlocks(200, 1)).toEqual(["add", "add", "add", "add", "del"]);
    expect(diffstatBlocks(1, 200)).toEqual(["add", "del", "del", "del", "del"]);
    expect(diffstatBlocks(2, 1)).toEqual(["add", "add", "del", "neutral", "neutral"]);
    expect(diffstatBlocks(0, 0)).toEqual(["neutral", "neutral", "neutral", "neutral", "neutral"]);
  });
});

describe("rows", () => {
  it("lists hunk headers between lines in the unified view", () => {
    const rows = unifiedRows(parsePatch(PATCH));
    expect(rows.filter((row) => row.kind === "hunk")).toHaveLength(2);
    expect(rows).toHaveLength(2 + 5 + 4);
  });

  it("pairs removed and added runs side by side", () => {
    const rows = splitRows(parsePatch(PATCH)).map((row) =>
      row.kind === "hunk" ? "hunk" : `${row.left?.old ?? "-"}|${row.right?.new ?? "-"}`
    );
    expect(rows).toEqual(["hunk", "10|10", "11|11", "-|12", "12|13", "hunk", "40|41", "41|-", "42|42"]);
  });

  it("hangs a comment on the old side for a removed line only", () => {
    const [hunk] = parsePatch(PATCH);
    expect(lineSide(hunk.lines[1])).toEqual({ side: "L", line: 11 });
    expect(lineSide(hunk.lines[2])).toEqual({ side: "R", line: 11 });
    expect(lineSide(hunk.lines[0])).toEqual({ side: "R", line: 10 });
  });

  it("quotes the lines leading up to a commented line", () => {
    const hunks = parsePatch(PATCH);
    expect(quotedLines(hunks, "R", 12, 3).map((line) => line.text)).toEqual(["old", "new one", "new two"]);
    expect(quotedLines(hunks, "L", 11).map((line) => line.text)).toEqual(["keep", "old"]);
    expect(quotedLines(hunks, "R", 999)).toEqual([]);
  });
});

describe("file tree", () => {
  const paths = [
    "src/budget/budget.service.ts",
    "src/budget/dto/variance-report.dto.ts",
    "src/common/money.ts",
    "migrations/20261002_add_line_code.sql",
    "README.md",
  ];

  it("puts folders first, files by name, and folds a lone folder into its parent", () => {
    const tree = buildTree(paths);
    expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual(["dir:migrations", "dir:src", "file:README.md"]);
    const src = tree[1];
    expect(src.kind === "dir" && src.children.map((node) => node.name)).toEqual(["budget", "common"]);
    expect(buildTree(["a/b/c/x.ts"]).map((node) => node.name)).toEqual(["a/b/c"]);
  });

  it("lists the files in tree order", () => {
    expect(treeFiles(buildTree(paths))).toEqual([
      "migrations/20261002_add_line_code.sql",
      "src/budget/dto/variance-report.dto.ts",
      "src/budget/budget.service.ts",
      "src/common/money.ts",
      "README.md",
    ]);
  });

  it("filters by path, keeping the folders on the way", () => {
    expect(treeFiles(filterTree(buildTree(paths), "DTO"))).toEqual(["src/budget/dto/variance-report.dto.ts"]);
    expect(filterTree(buildTree(paths), "nothing")).toEqual([]);
    expect(treeFiles(filterTree(buildTree(paths), " "))).toHaveLength(5);
  });
});
