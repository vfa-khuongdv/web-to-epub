import { describe, expect, it } from "vitest";
import { changeCounts, quotedLines } from "./diff";
import { DECOY_PULL, decoyPull, fakeRepository, lineOf } from "./fakeData";

const NOW = Date.parse("2026-10-06T09:00:00.000Z");

describe("fakeRepository", () => {
  const repo = fakeRepository(NOW);
  const numbers = [...repo.pulls.map((pull) => pull.number), ...repo.issues.map((issue) => issue.number)];

  it("numbers pull requests and issues from one sequence, without a clash", () => {
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(repo.pulls.map((pull) => pull.number)).toContain(DECOY_PULL);
  });

  it("points every reference at something that exists", () => {
    for (const pull of repo.pulls) for (const closed of pull.closes) expect(numbers).toContain(closed);
    for (const item of [...repo.pulls.flatMap((pull) => pull.timeline), ...repo.issues.flatMap((issue) => issue.timeline)]) {
      if (item.kind === "event" && item.event.type === "referenced") expect(numbers).toContain(item.event.number);
    }
  });

  it("gives every pull request commits, checks and changed files whose counts add up", () => {
    for (const pull of repo.pulls) {
      expect(pull.commits.length).toBeGreaterThan(0);
      expect(pull.checks.length).toBeGreaterThan(0);
      expect(pull.files.length).toBeGreaterThan(0);
      for (const file of pull.files) {
        const { additions, deletions } = changeCounts(file.hunks);
        expect(additions + deletions).toBeGreaterThan(0);
        if (file.status === "added") expect(deletions).toBe(0);
        // Every header agrees with its lines.
        for (const hunk of file.hunks) {
          const match = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(hunk.header)!;
          expect(hunk.lines.filter((line) => line.kind !== "add")).toHaveLength(Number(match[2]));
          expect(hunk.lines.filter((line) => line.kind !== "del")).toHaveLength(Number(match[4]));
        }
      }
    }
  });

  it("only lists commits a pull request has, and threads that exist", () => {
    for (const pull of repo.pulls) {
      const shas = pull.commits.map((commit) => commit.sha);
      const threads = pull.threads.map((thread) => thread.id);
      for (const item of pull.timeline) {
        if (item.kind === "commits") for (const sha of item.shas) expect(shas).toContain(sha);
        if (item.kind === "review") for (const id of item.threadIds) expect(threads).toContain(id);
      }
    }
  });

  it("hangs each review thread on a real line of a changed file", () => {
    const pull = decoyPull(NOW);
    for (const thread of pull.threads) {
      const file = pull.files.find((candidate) => candidate.path === thread.ref.path)!;
      expect(file).toBeDefined();
      expect(quotedLines(file.hunks, thread.ref.side, thread.ref.line).length).toBeGreaterThan(0);
    }
  });

  it("dates everything before now and is the same on every call", () => {
    for (const pull of repo.pulls) {
      expect(pull.at).toBeLessThan(NOW);
      for (const item of pull.timeline) expect(item.at).toBeLessThan(NOW);
    }
    expect(JSON.stringify(fakeRepository(NOW))).toBe(JSON.stringify(repo));
  });

  it("holds nothing but the made-up repository", () => {
    const text = JSON.stringify(repo);
    expect(text).not.toMatch(/chương|chapter|epub|novel|truyện/i);
  });
});

describe("lineOf", () => {
  it("finds a line by its text on the new side", () => {
    const pull = decoyPull(NOW);
    const migration = pull.files.find((file) => file.path.endsWith(".sql"))!;
    expect(lineOf(migration, "CREATE UNIQUE INDEX")).toEqual({ path: migration.path, side: "R", line: 9 });
    expect(() => lineOf(migration, "not there")).toThrow();
  });
});
