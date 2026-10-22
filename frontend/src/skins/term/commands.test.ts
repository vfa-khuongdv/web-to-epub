import { describe, expect, it } from "vitest";
import { OutLine, PlanContext, absolutePath, historyLines, planCommand } from "./commands";
import { DirNode, FileEntry, FsView, HOME, LIBRARY } from "./fs";
import { parseLine } from "./shellParse";
import { termCommands } from "./termCommands";

const t = (key: string, params?: Record<string, string | number>) =>
  key.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ""));

const FILES: FileEntry[] = [
  { order: 1, name: "ch-0001-mo-dau.md", state: "done" },
  { order: 2, name: "ch-0002-gap-lai.md", state: "error", error: "Timeout at https://site.example/truyen/x/chuong-2" },
  { order: 3, name: "ch-0003.md", state: "pending" },
];
const STORY: DirNode = { kind: "story", storyId: "s1" };

function context(overrides: Partial<PlanContext> = {}, loaded = true): PlanContext {
  const names = new Map([
    ["s1", "tro-ve"],
    ["s2", "dau-pha"],
  ]);
  const view: FsView = {
    dirName: (id) => names.get(id),
    storyByName: (name) => [...names].find(([, value]) => value === name)?.[0],
    files: (id) => (id === "s1" ? (loaded ? FILES : null) : id === "s2" ? [] : null),
  };
  return {
    cwd: LIBRARY,
    previous: null,
    view,
    storyIds: ["s1", "s2"],
    columns: 80,
    now: new Date(2026, 9, 6, 14, 2),
    crawling: () => false,
    sizeOf: (_id, file) => (file.state === "done" ? 18234 : 0),
    storyDate: () => new Date(2026, 9, 6, 9, 30).toISOString(),
    ...overrides,
  };
}

const plan = (line: string, overrides: Partial<PlanContext> = {}, loaded = true) =>
  planCommand(parseLine(line), context(overrides, loaded), t);

// The text a print plan would show, grid and long rows flattened.
function printed(line: string, overrides: Partial<PlanContext> = {}): string[] {
  const result = plan(line, overrides);
  if (result.type !== "print") throw new Error(`expected print, got ${result.type}`);
  return result.lines.map((out: OutLine) =>
    out.kind === "text"
      ? out.text
      : out.kind === "grid"
        ? out.cells.map((cell) => cell.name + " ".repeat(cell.pad)).join("")
        : `${out.row.meta} ${out.row.name}`
  );
}

describe("ls", () => {
  it("lists the library's folders and a folder's files", () => {
    expect(printed("ls")).toEqual(["dau-pha  tro-ve"]);
    expect(printed("ls", { cwd: STORY })).toEqual(["ch-0001-mo-dau.md  ch-0002-gap-lai.md  ch-0003.md"]);
    expect(printed("ls -1 ~")).toEqual(["Desktop", "Documents", "Downloads", "projects"]);
  });

  it("prints the long form with sizes and dates", () => {
    expect(printed("ls -l", { cwd: STORY })).toEqual([
      "total 40",
      "-rw-r--r--  1 dev  staff  18234 Oct  6 09:30 ch-0001-mo-dau.md",
      "-rw-r--r--  1 dev  staff      0 Oct  6 09:30 ch-0002-gap-lai.md",
      "-rw-r--r--  1 dev  staff      0 Oct  6 09:30 ch-0003.md",
    ]);
    expect(printed("ll")[1]).toMatch(/^drwxr-xr-x {2}2 dev {2}staff +64 Oct {2}6 09:30 dau-pha$/);
  });

  it("colours files by state", () => {
    const result = plan("ls", { cwd: STORY });
    if (result.type !== "print" || result.lines[0].kind !== "grid") throw new Error("expected a grid");
    expect(result.lines[0].cells.map((cell) => cell.tone)).toEqual(["file", "error", "pending"]);
  });

  it("answers as ls does to bad paths and flags", () => {
    expect(printed("ls nope")).toEqual(["ls: nope: No such file or directory"]);
    expect(printed("ls -z")).toEqual(["ls: invalid option -- 'z'", "usage: ls [-1ahlrt] [file ...]"]);
  });

  it("asks for a folder's files before listing them", () => {
    expect(plan("ls tro-ve", {}, false)).toEqual({ type: "need", storyId: "s1" });
  });
});

describe("cd and pwd", () => {
  it("changes folder, goes home with no argument and back with -", () => {
    expect(plan("cd tro-ve")).toEqual({ type: "cd", to: STORY });
    expect(plan("cd")).toEqual({ type: "cd", to: HOME });
    expect(plan("cd ..", { cwd: STORY })).toEqual({ type: "cd", to: LIBRARY });
    expect(plan("cd -", { previous: STORY })).toEqual({ type: "cd", to: STORY });
    expect(printed("cd -")).toEqual(["cd: no previous directory"]);
  });

  it("refuses files and unknown names in zsh's words", () => {
    expect(printed("cd nope")).toEqual(["cd: no such file or directory: nope"]);
    expect(printed("cd ch-0001-mo-dau.md", { cwd: STORY })).toEqual(["cd: not a directory: ch-0001-mo-dau.md"]);
  });

  it("prints the absolute path", () => {
    expect(printed("pwd", { cwd: STORY })).toEqual(["/Users/dev/projects/tro-ve"]);
    expect(absolutePath(HOME, context().view)).toBe("/Users/dev");
  });
});

describe("reading files", () => {
  it("plans cat, head and tail of downloaded files", () => {
    expect(plan("cat ch-0001-mo-dau.md", { cwd: STORY })).toEqual({
      type: "read",
      mode: "cat",
      files: [{ storyId: "s1", order: 1, name: "ch-0001-mo-dau.md" }],
      count: 10,
      before: [],
    });
    expect(plan("head -n 3 tro-ve/ch-0001-mo-dau.md")).toMatchObject({ type: "read", mode: "head", count: 3 });
    expect(plan("tail -20 ch-0001-mo-dau.md", { cwd: STORY })).toMatchObject({ type: "read", mode: "tail", count: 20 });
  });

  it("says why a file cannot be read, never printing an address", () => {
    expect(printed("cat ch-0003.md", { cwd: STORY })).toEqual(["cat: ch-0003.md: Not downloaded yet."]);
    const failed = printed("cat ch-0002-gap-lai.md", { cwd: STORY })[0];
    expect(failed).toMatch(/^cat: ch-0002-gap-lai.md: Download failed: Timeout at …$/);
    expect(failed).not.toContain("site.example");
    expect(printed("cat tro-ve")).toEqual(["cat: tro-ve: Is a directory"]);
    expect(printed("head -n x f", { cwd: STORY })).toEqual(["head: illegal line count -- x"]);
  });

  it("keeps errors for some files while reading the others", () => {
    expect(plan("cat nope ch-0001-mo-dau.md", { cwd: STORY })).toMatchObject({
      type: "read",
      files: [{ order: 1 }],
      before: [{ kind: "text", text: "cat: nope: No such file or directory", tone: "error" }],
    });
  });

  it("opens the pager, or resumes in a folder with no file named", () => {
    expect(plan("less ch-0001-mo-dau.md", { cwd: STORY })).toEqual({
      type: "pager",
      file: { storyId: "s1", order: 1, name: "ch-0001-mo-dau.md" },
    });
    expect(plan("more", { cwd: STORY })).toEqual({ type: "pager", file: null });
    expect(printed("less")).toEqual(['Missing filename ("less --help" for help)']);
    expect(printed("less tro-ve")).toEqual(["tro-ve is a directory"]);
  });
});

describe("downloads and the app", () => {
  it("syncs the folder the shell is in, or the one named, in the background with &", () => {
    expect(plan("sync", { cwd: STORY })).toEqual({ type: "sync", storyId: "s1", background: false });
    expect(plan("sync tro-ve &")).toEqual({ type: "sync", storyId: "s1", background: true });
    expect(printed("sync")).toEqual(["sync: No folder is open."]);
  });

  it("stops only a running download", () => {
    expect(printed("stop", { cwd: STORY })).toEqual(["Nothing is downloading."]);
    expect(plan("stop", { cwd: STORY, crawling: () => true })).toEqual({ type: "stop", storyId: "s1" });
  });

  it("opens the normal view at a folder or file", () => {
    expect(plan("open")).toEqual({ type: "open" });
    expect(plan("open", { cwd: STORY })).toEqual({ type: "open", storyId: "s1" });
    expect(plan("open ch-0001-mo-dau.md", { cwd: STORY })).toEqual({ type: "open", storyId: "s1", order: 1 });
  });

  it("maps the shell's own commands", () => {
    expect(plan("settings")).toEqual({ type: "settings" });
    expect(plan("clear")).toEqual({ type: "clear" });
    expect(plan("exit")).toEqual({ type: "exit" });
    expect(plan("hide")).toEqual({ type: "hide" });
    expect(plan("history")).toEqual({ type: "history" });
    expect(plan("   ")).toEqual({ type: "none" });
    expect(printed("whoami")).toEqual(["dev"]);
    expect(printed("echo a  b")).toEqual(["a b"]);
  });

  it("answers unknown commands and open quotes as zsh does", () => {
    expect(printed("rm -rf x")).toEqual(["zsh: command not found: rm"]);
    expect(printed(`echo "x`)).toEqual(['zsh: unmatched "']);
  });

  it("lists help with every command", () => {
    const help = printed("help").join("\n");
    for (const name of ["ls", "cd", "less", "cat", "sync", "stop", "open", "settings", "clear", "exit"]) {
      expect(help).toContain(name);
    }
    expect(help).toContain("Download the rest");
  });

  it("numbers the history", () => {
    expect(historyLines(["ls", "cd x"]).map((line) => (line.kind === "text" ? line.text : ""))).toEqual([
      "    1  ls",
      "    2  cd x",
    ]);
  });
});

describe("termCommands", () => {
  const input = {
    stepFile: () => {},
    quitPager: () => {},
    goToFile: () => {},
    clear: () => {},
    zoom: () => {},
    mod: "Ctrl",
  };

  it("offers file steps only while reading", () => {
    const reading = termCommands({ ...input, pagerOpen: true }, t).map((command) => command.id);
    expect(reading.slice(0, 3)).toEqual(["next-file", "previous-file", "quit-pager"]);
    expect(reading).not.toContain("clear");
    const shell = termCommands({ ...input, pagerOpen: false }, t).map((command) => command.id);
    expect(shell).not.toContain("next-file");
    expect(shell).toContain("clear");
  });
});
