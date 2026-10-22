import { describe, expect, it } from "vitest";
import { StoredChapter, StoredStory, StorySummary } from "../../types";
import {
  ChapterData,
  PAGE_SIZE,
  TreeInput,
  TreeRow,
  buildTree,
  fileKey,
  fileState,
  nameMatches,
  pageCount,
  pageOf,
  pageRange,
  parentKey,
  queryWords,
  searchTree,
} from "./tree";

function summary(id: string, title: string, counts: Partial<StorySummary> = {}): StorySummary {
  return {
    id,
    storyUrl: `https://example.test/${id}`,
    site: "example.test",
    title,
    chapterCount: 0,
    doneCount: 0,
    errorCount: 0,
    watching: false,
    newChapterCount: 0,
    updatedAt: "2026-01-01T00:00:00Z",
    ...counts,
  };
}

function chapter(order: number, status: StoredChapter["status"] = "done", title = `Chương ${order}`): StoredChapter {
  return { order, url: `https://example.test/c/${order}`, title, status };
}

function story(id: string, chapters: StoredChapter[]): StoredStory {
  return {
    id,
    storyUrl: `https://example.test/${id}`,
    site: "example.test",
    title: id,
    watching: false,
    newChapterCount: 0,
    chapters,
    createdAt: "",
    updatedAt: "",
  };
}

const data = (s: StoredStory | null, extra: Partial<ChapterData> = {}): ChapterData => ({
  story: s,
  loading: false,
  error: null,
  reload: () => {},
  ...extra,
});

function input(overrides: Partial<TreeInput>): TreeInput {
  return {
    stories: [],
    names: new Map(),
    expanded: new Set(),
    data: {},
    pages: {},
    live: {},
    overlay: null,
    neutral: false,
    ...overrides,
  };
}

const kinds = (rows: TreeRow[]) => rows.map((row) => row.kind);

describe("paging", () => {
  it("counts pages, at least one", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(PAGE_SIZE)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
  });

  it("finds a chapter's page", () => {
    expect(pageOf(0)).toBe(0);
    expect(pageOf(PAGE_SIZE - 1)).toBe(0);
    expect(pageOf(PAGE_SIZE)).toBe(1);
  });

  it("clamps a page to the list", () => {
    expect(pageRange(450, 1)).toEqual({ page: 1, start: 200, end: 400 });
    expect(pageRange(450, 9)).toEqual({ page: 2, start: 400, end: 450 });
    expect(pageRange(450, -1)).toEqual({ page: 0, start: 0, end: 200 });
  });
});

describe("fileState", () => {
  it("keeps a stored status", () => {
    expect(fileState(chapter(1, "done"))).toBe("done");
    expect(fileState(chapter(1, "error"))).toBe("error");
  });

  it("lets the live crawl move a pending chapter", () => {
    const c = chapter(1, "pending");
    expect(fileState(c)).toBe("pending");
    expect(fileState(c, { [c.url]: "running" })).toBe("running");
    expect(fileState(c, { [c.url]: "done" })).toBe("done");
  });
});

describe("buildTree", () => {
  it("lists collapsed folders with their counts", () => {
    const rows = buildTree(
      input({
        stories: [
          summary("a", "A", { chapterCount: 3, doneCount: 2, errorCount: 1 }),
          summary("b", "B", { chapterCount: 2, doneCount: 2 }),
        ],
        names: new Map([
          ["a", "tro-ve"],
          ["b", "module-02"],
        ]),
        live: { b: { cursor: 1, total: 2, errors: 0 } },
      })
    );
    expect(kinds(rows)).toEqual(["folder", "folder"]);
    expect(rows[0]).toMatchObject({ name: "tro-ve", errors: 1, pending: false, crawl: null, posinset: 1, setsize: 2 });
    expect(rows[1]).toMatchObject({ name: "module-02", crawl: { cursor: 1, total: 2 } });
  });

  it("shows a loading note until the chapter list arrives, and an error after a failure", () => {
    const base = input({ stories: [summary("a", "A")], expanded: new Set(["a"]) });
    expect(buildTree(base)[1]).toMatchObject({ kind: "note", note: "loading" });
    const failed = buildTree({ ...base, data: { a: data(null, { error: "boom" }) } });
    expect(failed[1]).toMatchObject({ kind: "note", note: "error", message: "boom" });
    const empty = buildTree({ ...base, data: { a: data(story("a", [])) } });
    expect(empty[1]).toMatchObject({ kind: "note", note: "empty" });
  });

  it("lists files with names, states and the overlay", () => {
    const chapters = [chapter(1, "done", "Gặp lại"), chapter(2, "pending"), chapter(3, "error")];
    chapters[2].error = "HTTP 403";
    const rows = buildTree(
      input({
        stories: [summary("a", "A")],
        expanded: new Set(["a"]),
        data: { a: data(story("a", chapters)) },
        overlay: { storyId: "a", chapters: { [chapters[1].url]: "running" } },
      })
    );
    expect(kinds(rows)).toEqual(["folder", "file", "file", "file"]);
    expect(rows[1]).toMatchObject({ name: "ch-0001-gap-lai.md", state: "done", key: fileKey("a", 1) });
    expect(rows[2]).toMatchObject({ state: "running", posinset: 2, setsize: 3 });
    expect(rows[3]).toMatchObject({ state: "error", error: "HTTP 403" });
    // Counts come from the loaded list once it is there.
    expect(rows[0]).toMatchObject({ errors: 1, pending: true });
  });

  it("never shows titles with neutral names", () => {
    const rows = buildTree(
      input({
        stories: [summary("a", "A")],
        expanded: new Set(["a"]),
        data: { a: data(story("a", [chapter(12, "done", "Bí mật")])) },
        neutral: true,
      })
    );
    expect(rows[1]).toMatchObject({ name: "part-0012.md" });
  });

  it("shows one page of a long story with ways to the others", () => {
    const chapters = Array.from({ length: 450 }, (_, i) => chapter(i + 1));
    const base = input({ stories: [summary("a", "A")], expanded: new Set(["a"]), data: { a: data(story("a", chapters)) } });

    const first = buildTree(base);
    expect(first.filter((row) => row.kind === "file")).toHaveLength(PAGE_SIZE);
    expect(first[first.length - 1]).toMatchObject({ kind: "page", direction: 1, from: 201, to: 400, focusAfter: fileKey("a", 201) });

    const middle = buildTree({ ...base, pages: { a: 1 } });
    expect(middle[1]).toMatchObject({ kind: "page", direction: -1, from: 1, to: 200, focusAfter: fileKey("a", 200) });
    expect(middle[2]).toMatchObject({ kind: "file", order: 201 });
    expect(middle[middle.length - 1]).toMatchObject({ kind: "page", direction: 1, from: 401, to: 450 });

    const last = buildTree({ ...base, pages: { a: 2 } });
    expect(last.filter((row) => row.kind === "file")).toHaveLength(50);
    expect(last[last.length - 1]).toMatchObject({ kind: "file", order: 450 });
  });

  it("knows each row's folder", () => {
    const rows = buildTree(
      input({ stories: [summary("a", "A")], expanded: new Set(["a"]), data: { a: data(story("a", [chapter(1)])) } })
    );
    expect(parentKey(rows[0])).toBeNull();
    expect(parentKey(rows[1])).toBe("f:a");
  });
});

describe("search", () => {
  it("folds the query like the names", () => {
    expect(queryWords("  Gặp LẠI ")).toEqual(["gap", "lai"]);
    expect(nameMatches(["gap", "lai"], "ch-0001-gap-lai.md")).toBe(true);
    expect(nameMatches(["gap", "x"], "ch-0001-gap-lai.md")).toBe(false);
    expect(nameMatches([], "anything")).toBe(false);
  });

  const stories = [summary("a", "A"), summary("b", "B"), summary("c", "C")];
  const names = new Map([
    ["a", "tro-ve"],
    ["b", "gap-lai-ban-cu"],
    ["c", "module-03"],
  ]);

  it("finds folders and the files of loaded folders", () => {
    const result = searchTree("gap", {
      stories,
      names,
      data: { a: data(story("a", [chapter(1, "done", "Gặp lại"), chapter(2, "done", "Chia tay")])) },
      overlay: null,
      neutral: false,
    });
    expect(result.groups.map((group) => [group.storyId, group.folderMatch, group.files.map((f) => f.order)])).toEqual([
      ["a", false, [1]],
      ["b", true, []],
    ]);
    expect(result.count).toBe(1);
    expect(result.unsearched).toBe(2);
  });

  it("stops listing at the limit but keeps counting", () => {
    const chapters = Array.from({ length: 30 }, (_, i) => chapter(i + 1, "done", "Gặp"));
    const result = searchTree(
      "gap",
      { stories: [summary("a", "A")], names, data: { a: data(story("a", chapters)) }, overlay: null, neutral: false },
      10
    );
    expect(result.groups[0].files).toHaveLength(10);
    expect(result.count).toBe(30);
    expect(result.truncated).toBe(true);
  });

  it("finds nothing for an empty query", () => {
    expect(searchTree("  ", { stories, names, data: {}, overlay: null, neutral: false }).groups).toEqual([]);
  });
});
