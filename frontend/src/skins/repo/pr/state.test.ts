import { describe, expect, it } from "vitest";
import { decoyPull, fakeRepository } from "./fakeData";
import {
  PrState,
  canSubmitReview,
  commentCount,
  commitsByDay,
  conversationCount,
  initialIssueState,
  initialPrState,
  issueReducer,
  pendingCount,
  prReducer,
  reviewDecision,
  threadsByLine,
  viewedCount,
} from "./state";
import { LineRef, ME } from "./types";

const NOW = Date.parse("2026-10-06T09:00:00.000Z");
const pull = decoyPull(NOW);
const ref: LineRef = { path: "src/common/money.ts", side: "R", line: 3 };

function run(state: PrState, ...actions: Parameters<typeof prReducer>[1][]): PrState {
  return actions.reduce(prReducer, state);
}

describe("prReducer: comments and reviews", () => {
  it("adds a conversation comment, ignoring an empty one", () => {
    const start = initialPrState(pull);
    expect(prReducer(start, { type: "comment", body: "   ", at: NOW })).toBe(start);
    const state = prReducer(start, { type: "comment", body: " Đã xem, ok. ", at: NOW });
    expect(state.timeline.at(-1)).toMatchObject({ kind: "comment", author: ME, body: "Đã xem, ok." });
    expect(conversationCount(state)).toBe(conversationCount(start) + 1);
  });

  it("shows a single line comment at once, as a review of its own", () => {
    const state = prReducer(initialPrState(pull), { type: "line-comment", ref, body: "Thiếu test cho USD", at: NOW, review: false });
    expect(pendingCount(state)).toBe(0);
    const review = state.timeline.at(-1);
    expect(review).toMatchObject({ kind: "review", state: "commented", author: ME });
    expect(review?.kind === "review" && review.threadIds).toEqual([state.threads.at(-1)!.id]);
  });

  it("keeps review comments pending until the review is submitted", () => {
    const start = initialPrState(pull);
    const existing = start.threads[0].id;
    let state = run(
      start,
      { type: "line-comment", ref, body: "Một", at: NOW, review: true },
      { type: "line-comment", ref: { ...ref, line: 8 }, body: "Hai", at: NOW, review: true },
      { type: "reply", threadId: existing, body: "Đồng ý", at: NOW, review: true }
    );
    expect(pendingCount(state)).toBe(3);
    // Pending comments are not part of the conversation yet.
    expect(state.timeline).toHaveLength(start.timeline.length);
    expect(conversationCount(state)).toBe(conversationCount(start));

    state = prReducer(state, { type: "submit-review", state: "changes_requested", body: "Sửa giúp mình", at: NOW + 1 });
    expect(pendingCount(state)).toBe(0);
    const review = state.timeline.at(-1)!;
    expect(review).toMatchObject({ kind: "review", state: "changes_requested", body: "Sửa giúp mình", at: NOW + 1 });
    // The two new threads go under the review; the reply stays in its old thread.
    expect(review.kind === "review" && review.threadIds).toHaveLength(2);
    expect(state.threads.find((thread) => thread.id === existing)!.comments.at(-1)).toMatchObject({ body: "Đồng ý", pending: false });
    expect(state.reviewers.find((reviewer) => reviewer.login === ME)).toEqual({ login: ME, state: "changes_requested" });
    expect(reviewDecision(state.reviewers)).toBe("changes_requested");
  });

  it("refuses an empty comment-only review but takes a bare approval", () => {
    const start = initialPrState(pull);
    expect(canSubmitReview(start, "commented", " ")).toBe(false);
    expect(prReducer(start, { type: "submit-review", state: "commented", body: "", at: NOW })).toBe(start);
    expect(canSubmitReview(start, "approved", "")).toBe(true);
    const pending = prReducer(start, { type: "line-comment", ref, body: "x", at: NOW, review: true });
    expect(canSubmitReview(pending, "commented", "")).toBe(true);
  });

  it("discards a pending review, dropping threads left empty", () => {
    const start = initialPrState(pull);
    const state = run(
      start,
      { type: "line-comment", ref, body: "Một", at: NOW, review: true },
      { type: "reply", threadId: start.threads[0].id, body: "Hai", at: NOW, review: true },
      { type: "discard-review" }
    );
    expect(pendingCount(state)).toBe(0);
    expect(state.threads).toHaveLength(start.threads.length);
    expect(state.threads[0].comments).toHaveLength(start.threads[0].comments.length);
  });

  it("resolves a thread and finds threads by line", () => {
    const start = initialPrState(pull);
    const thread = start.threads[0];
    const state = prReducer(start, { type: "resolve", threadId: thread.id, resolved: true });
    expect(state.threads[0].resolved).toBe(true);
    const byLine = threadsByLine(state.threads, thread.ref.path);
    expect(byLine.get(`${thread.ref.side}${thread.ref.line}`)).toEqual([state.threads[0]]);
  });
});

describe("prReducer: files, merging and closing", () => {
  it("marks files viewed", () => {
    const paths = pull.files.map((file) => file.path);
    const state = run(
      initialPrState(pull),
      { type: "viewed", path: paths[0], viewed: true },
      { type: "viewed", path: paths[1], viewed: true },
      { type: "viewed", path: paths[0], viewed: false }
    );
    expect(viewedCount(state, paths)).toBe(1);
  });

  it("merges once, then lets the branch go and come back", () => {
    let state = prReducer(initialPrState(pull), { type: "merge", sha: "abc1234", at: NOW });
    expect(state.status).toBe("merged");
    expect(state.timeline.at(-1)).toMatchObject({ kind: "event", event: { type: "merged", sha: "abc1234" } });
    expect(prReducer(state, { type: "merge", sha: "x", at: NOW })).toBe(state);
    expect(canSubmitReview(state, "approved", "")).toBe(false);
    state = prReducer(state, { type: "delete-branch", branch: pull.head, at: NOW });
    expect(state.branchDeleted).toBe(true);
    state = prReducer(state, { type: "restore-branch", branch: pull.head, at: NOW });
    expect(state.branchDeleted).toBe(false);
    expect(state.timeline.slice(-2).map((item) => item.kind === "event" && item.event.type)).toEqual(["branch_deleted", "branch_restored"]);
  });

  it("merges a draft only once it is ready for review", () => {
    const draft = fakeRepository(NOW).pulls.find((candidate) => candidate.draft)!;
    let state = initialPrState(draft);
    expect(prReducer(state, { type: "merge", sha: "x", at: NOW })).toBe(state);
    state = prReducer(state, { type: "ready", at: NOW });
    expect(state.draft).toBe(false);
    expect(prReducer(state, { type: "merge", sha: "x", at: NOW }).status).toBe("merged");
  });

  it("closes with a comment and reopens", () => {
    let state = prReducer(initialPrState(pull), { type: "comment", body: "Tách PR khác", at: NOW, close: true });
    expect(state.status).toBe("closed");
    expect(state.timeline.slice(-2).map((item) => item.kind)).toEqual(["comment", "event"]);
    state = prReducer(state, { type: "reopen", at: NOW });
    expect(state.status).toBe("open");
    expect(prReducer(state, { type: "reopen", at: NOW })).toBe(state);
  });
});

describe("commitsByDay", () => {
  it("groups commits by the day they were made, oldest first", () => {
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();
    const commit = (sha: string, when: number) => ({ sha, message: sha, author: "a", at: when, status: "success" as const });
    const groups = commitsByDay([commit("c", at(6, 9)), commit("a", at(5, 10)), commit("b", at(5, 16)), commit("d", at(6, 15))]);
    expect(groups.map((group) => [group.day, group.commits.map((item) => item.sha).join("")])).toEqual([
      ["Oct 5, 2026", "ab"],
      ["Oct 6, 2026", "cd"],
    ]);
  });
});

describe("issueReducer", () => {
  const repo = fakeRepository(NOW);
  const open = repo.issues.find((issue) => issue.state === "open")!;
  const closed = repo.issues.find((issue) => issue.state === "closed" && issue.number === 465)!;

  it("reads how a closed issue was closed", () => {
    expect(initialIssueState(open)).toMatchObject({ status: "open", reason: null });
    expect(initialIssueState(closed)).toMatchObject({ status: "closed", reason: "not_planned" });
  });

  it("comments, closes with a comment and reopens", () => {
    let state = issueReducer(initialIssueState(open), { type: "comment", body: "Đã kiểm tra", at: NOW });
    expect(commentCount(state.timeline)).toBe(commentCount(open.timeline) + 1);
    state = issueReducer(state, { type: "comment", body: "Xong", at: NOW, close: "completed" });
    expect(state).toMatchObject({ status: "closed", reason: "completed" });
    expect(issueReducer(state, { type: "close", reason: "not_planned", at: NOW })).toBe(state);
    state = issueReducer(state, { type: "reopen", at: NOW });
    expect(state).toMatchObject({ status: "open", reason: null });
    expect(state.timeline.at(-1)).toMatchObject({ kind: "event", event: { type: "reopened" } });
  });
});
