import { describe, expect, it } from "vitest";
import { fakeRepository } from "./fakeData";
import { issueRow, newestFirst, pullRow } from "./rows";
import { initialIssueState, initialPrState, issueReducer, prReducer } from "./state";

const NOW = Date.parse("2026-10-06T09:00:00.000Z");
const repo = fakeRepository(NOW);

describe("pullRow", () => {
  it("shows a pull request's checks, review, tasks and comments", () => {
    const pull = repo.pulls.find((candidate) => candidate.number === 482)!;
    expect(pullRow(pull)).toMatchObject({ state: "open", checks: "success", review: "approved", tasks: { done: 2, total: 3 }, endedAt: null });
    expect(pullRow(pull).comments).toBeGreaterThan(0);
    expect(pullRow(repo.pulls.find((candidate) => candidate.number === 481)!)).toMatchObject({ checks: "failure", review: "changes_requested" });
    expect(pullRow(repo.pulls.find((candidate) => candidate.draft)!)).toMatchObject({ draft: true, review: null });
  });

  it("follows what was done on the page", () => {
    const pull = repo.pulls.find((candidate) => candidate.number === 482)!;
    const merged = prReducer(prReducer(initialPrState(pull), { type: "comment", body: "ok", at: NOW }), { type: "merge", sha: "abc1234", at: NOW });
    const row = pullRow(pull, merged);
    expect(row).toMatchObject({ state: "merged", endedAt: NOW, review: null });
    expect(row.comments).toBe(pullRow(pull).comments + 1);
  });
});

describe("issueRow", () => {
  it("shows how an issue was closed, and when", () => {
    const issue = repo.issues.find((candidate) => candidate.number === 465)!;
    expect(issueRow(issue)).toMatchObject({ state: "closed", closedReason: "not_planned" });
    const open = repo.issues.find((candidate) => candidate.number === 483)!;
    const closed = issueReducer(initialIssueState(open), { type: "close", reason: "completed", at: NOW });
    expect(issueRow(open, closed)).toMatchObject({ state: "closed", closedReason: "completed", endedAt: NOW });
  });

  it("sorts newest first", () => {
    const rows = newestFirst(repo.issues.map((issue) => issueRow(issue)));
    expect(rows[0].number).toBe(483);
    expect(rows.map((row) => row.at)).toEqual([...rows.map((row) => row.at)].sort((a, b) => b - a));
  });
});
