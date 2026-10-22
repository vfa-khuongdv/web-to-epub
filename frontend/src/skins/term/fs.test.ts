import { describe, expect, it } from "vitest";
import {
  FileEntry,
  FsView,
  HOME,
  LIBRARY,
  adjacentFile,
  chapterState,
  dirBase,
  dirPath,
  listDir,
  parentOf,
  resolvePath,
  resumeFile,
  uniqueNames,
} from "./fs";

const FILES: FileEntry[] = [
  { order: 1, name: "ch-0001.md", state: "done" },
  { order: 2, name: "ch-0002.md", state: "error", error: "x" },
  { order: 3, name: "ch-0003.md", state: "done" },
  { order: 4, name: "ch-0004.md", state: "pending" },
];

function makeView(loaded = true): FsView {
  const names = new Map([
    ["s1", "tro-ve"],
    ["s2", "module-02"],
  ]);
  return {
    dirName: (id) => names.get(id),
    storyByName: (name) => [...names].find(([, value]) => value === name)?.[0],
    files: (id) => (id === "s1" && loaded ? FILES : id === "s2" ? [] : null),
  };
}

describe("uniqueNames", () => {
  it("suffixes repeated names and leaves the rest alone", () => {
    expect(uniqueNames(["a", "b", "a", "a"])).toEqual(["a", "b", "a-2", "a-3"]);
    expect(uniqueNames(["a", "a-2", "a"])).toEqual(["a", "a-2", "a-3"]);
  });
});

describe("resolvePath", () => {
  const view = makeView();
  const story = { kind: "story" as const, storyId: "s1" };

  it("walks relative paths, .., ~ and the home folder written out", () => {
    expect(resolvePath(LIBRARY, "tro-ve", view)).toEqual({ ok: true, node: story });
    expect(resolvePath(story, "..", view)).toEqual({ ok: true, node: LIBRARY });
    expect(resolvePath(story, "../..", view)).toEqual({ ok: true, node: HOME });
    expect(resolvePath(HOME, "../../..", view)).toEqual({ ok: true, node: HOME });
    expect(resolvePath(story, "~", view)).toEqual({ ok: true, node: HOME });
    expect(resolvePath(HOME, "~/projects/tro-ve/ch-0003.md", view)).toEqual({
      ok: true,
      node: { kind: "file", storyId: "s1", order: 3 },
    });
    expect(resolvePath(HOME, "/Users/dev/projects/", view)).toEqual({ ok: true, node: LIBRARY });
    expect(resolvePath(HOME, "Downloads", view)).toEqual({ ok: true, node: { kind: "extra", name: "Downloads" } });
    expect(resolvePath(story, "", view)).toEqual({ ok: true, node: story });
  });

  it("says what is wrong with a path", () => {
    expect(resolvePath(LIBRARY, "nope", view)).toEqual({ ok: false, reason: "missing" });
    expect(resolvePath(story, "ch-0001.md/x", view)).toEqual({ ok: false, reason: "notdir" });
    expect(resolvePath(story, "ch-0001.md/", view)).toEqual({ ok: false, reason: "notdir" });
    expect(resolvePath(HOME, "/etc", view)).toEqual({ ok: false, reason: "missing" });
  });

  it("asks for a folder's files when they are not loaded", () => {
    expect(resolvePath(LIBRARY, "tro-ve/ch-0001.md", makeView(false))).toEqual({ ok: false, reason: "need", storyId: "s1" });
  });
});

describe("paths and listings", () => {
  const view = makeView();

  it("writes folders as the prompt does", () => {
    expect(dirPath(HOME, view)).toBe("~");
    expect(dirPath(LIBRARY, view)).toBe("~/projects");
    expect(dirPath({ kind: "story", storyId: "s1" }, view)).toBe("~/projects/tro-ve");
    expect(dirBase({ kind: "story", storyId: "s1" }, view)).toBe("tro-ve");
    expect(dirBase(HOME, view)).toBe("~");
    expect(parentOf({ kind: "file", storyId: "s1", order: 1 })).toEqual({ kind: "story", storyId: "s1" });
  });

  it("lists folders by name and files by order", () => {
    expect(listDir(HOME, view, [])?.map((entry) => entry.name)).toEqual(["Desktop", "Documents", "Downloads", "projects"]);
    expect(listDir(LIBRARY, view, ["s1", "s2"])?.map((entry) => entry.name)).toEqual(["module-02", "tro-ve"]);
    expect(listDir({ kind: "story", storyId: "s1" }, view, [])?.map((entry) => entry.name)).toEqual([
      "ch-0001.md",
      "ch-0002.md",
      "ch-0003.md",
      "ch-0004.md",
    ]);
    expect(listDir({ kind: "story", storyId: "s1" }, makeView(false), [])).toBeNull();
  });
});

describe("files", () => {
  it("takes the live state of a chapter still pending", () => {
    expect(chapterState({ status: "done", url: "u" }, { u: "error" })).toBe("done");
    expect(chapterState({ status: "pending", url: "u" }, { u: "running" })).toBe("running");
    expect(chapterState({ status: "pending", url: "u" })).toBe("pending");
  });

  it("steps to the next readable file, skipping failed ones", () => {
    expect(adjacentFile(FILES, 1, 1)).toEqual({ ok: true, order: 3, at: 3, of: 4 });
    expect(adjacentFile(FILES, 3, -1)).toEqual({ ok: true, order: 1, at: 1, of: 4 });
    expect(adjacentFile(FILES, 3, 1)).toEqual({ ok: false, reason: "pending" });
    expect(adjacentFile(FILES, 1, -1)).toEqual({ ok: false, reason: "end" });
  });

  it("resumes at the file read last, else the first downloaded", () => {
    expect(resumeFile(FILES, { order: 3, line: 12 })).toEqual({ order: 3, line: 12 });
    expect(resumeFile(FILES, { order: 4, line: 12 })).toEqual({ order: 1, line: 0 });
    expect(resumeFile(FILES, null)).toEqual({ order: 1, line: 0 });
    expect(resumeFile([{ order: 1, name: "a", state: "pending" }], null)).toBeNull();
  });
});
