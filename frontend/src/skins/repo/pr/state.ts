// What happens on a pull request or an issue page, as reducers: comments, line comments
// and replies (on their own or as part of a review), submitting or discarding a review,
// files marked viewed, merging, closing and reopening. Everything stays in memory —
// nothing is sent or stored — and the page is a plain function of this state.

import {
  Commit,
  Issue,
  LineRef,
  ME,
  PullRequest,
  ReviewState,
  ReviewThread,
  Reviewer,
  TimelineEvent,
  TimelineItem,
} from "./types";

export type PrStatus = "open" | "merged" | "closed";
export type MergeMethod = "merge" | "squash" | "rebase";

export interface PrState {
  status: PrStatus;
  draft: boolean;
  timeline: TimelineItem[];
  threads: ReviewThread[];
  reviewers: Reviewer[];
  viewed: Record<string, boolean>;
  branchDeleted: boolean;
  subscribed: boolean;
  // Ids for what is written on the page.
  seq: number;
}

export type PrAction =
  | { type: "comment"; body: string; at: number; close?: boolean }
  | { type: "line-comment"; ref: LineRef; body: string; at: number; review: boolean }
  | { type: "reply"; threadId: string; body: string; at: number; review: boolean }
  | { type: "resolve"; threadId: string; resolved: boolean }
  | { type: "submit-review"; state: ReviewState; body: string; at: number }
  | { type: "discard-review" }
  | { type: "viewed"; path: string; viewed: boolean }
  | { type: "merge"; sha: string; at: number }
  | { type: "close"; at: number }
  | { type: "reopen"; at: number }
  | { type: "delete-branch"; branch: string; at: number }
  | { type: "restore-branch"; branch: string; at: number }
  | { type: "ready"; at: number }
  | { type: "subscribe"; subscribed: boolean };

export function initialPrState(pr: PullRequest): PrState {
  return {
    status: pr.state,
    draft: pr.draft,
    timeline: pr.timeline,
    threads: pr.threads,
    reviewers: pr.reviewers,
    viewed: {},
    branchDeleted: false,
    subscribed: true,
    seq: 0,
  };
}

const event = (id: string, at: number, value: TimelineEvent): TimelineItem => ({ kind: "event", id, author: ME, at, event: value });

function withReviewer(reviewers: Reviewer[], login: string, state: ReviewState): Reviewer[] {
  const found = reviewers.some((reviewer) => reviewer.login === login);
  return found ? reviewers.map((reviewer) => (reviewer.login === login ? { ...reviewer, state } : reviewer)) : [...reviewers, { login, state }];
}

export function prReducer(state: PrState, action: PrAction): PrState {
  const id = (prefix: string) => `${prefix}-local-${state.seq + 1}`;
  const next = { ...state, seq: state.seq + 1 };
  switch (action.type) {
    case "comment": {
      const body = action.body.trim();
      if (!body && !action.close) return state;
      if (action.close && state.status !== "open") return state;
      const timeline = body ? [...state.timeline, { kind: "comment" as const, id: id("comment"), author: ME, at: action.at, body }] : state.timeline;
      if (!action.close) return { ...next, timeline };
      return { ...next, status: "closed", timeline: [...timeline, event(id("closed"), action.at, { type: "closed" })] };
    }
    case "line-comment": {
      const body = action.body.trim();
      if (!body) return state;
      const thread: ReviewThread = {
        id: id("thread"),
        ref: action.ref,
        resolved: false,
        comments: [{ id: id("line"), author: ME, body, at: action.at, pending: action.review }],
      };
      const threads = [...state.threads, thread];
      if (action.review) return { ...next, threads };
      // A single comment is a review of its own, shown in the conversation at once.
      const review: TimelineItem = { kind: "review", id: id("review"), author: ME, at: action.at, state: "commented", body: "", threadIds: [thread.id] };
      return { ...next, threads, timeline: [...state.timeline, review] };
    }
    case "reply": {
      const body = action.body.trim();
      if (!body || !state.threads.some((thread) => thread.id === action.threadId)) return state;
      return {
        ...next,
        threads: state.threads.map((thread) =>
          thread.id === action.threadId
            ? { ...thread, comments: [...thread.comments, { id: id("reply"), author: ME, body, at: action.at, pending: action.review }] }
            : thread
        ),
      };
    }
    case "resolve":
      return { ...state, threads: state.threads.map((thread) => (thread.id === action.threadId ? { ...thread, resolved: action.resolved } : thread)) };
    case "submit-review": {
      if (!canSubmitReview(state, action.state, action.body)) return state;
      // Threads this review opened go under it in the conversation; replies to older
      // threads just stop being pending.
      const opened = state.threads.filter((thread) => thread.comments[0]?.pending).map((thread) => thread.id);
      const threads = state.threads.map((thread) =>
        thread.comments.some((comment) => comment.pending)
          ? { ...thread, comments: thread.comments.map((comment) => (comment.pending ? { ...comment, pending: false, at: action.at } : comment)) }
          : thread
      );
      const review: TimelineItem = { kind: "review", id: id("review"), author: ME, at: action.at, state: action.state, body: action.body.trim(), threadIds: opened };
      return { ...next, threads, timeline: [...state.timeline, review], reviewers: withReviewer(state.reviewers, ME, action.state) };
    }
    case "discard-review":
      return {
        ...state,
        threads: state.threads
          .map((thread) => ({ ...thread, comments: thread.comments.filter((comment) => !comment.pending) }))
          .filter((thread) => thread.comments.length > 0),
      };
    case "viewed":
      return { ...state, viewed: { ...state.viewed, [action.path]: action.viewed } };
    case "ready":
      if (!state.draft || state.status !== "open") return state;
      return { ...next, draft: false, timeline: [...state.timeline, event(id("ready"), action.at, { type: "ready" })] };
    case "merge":
      if (state.status !== "open" || state.draft) return state;
      return { ...next, status: "merged", timeline: [...state.timeline, event(id("merged"), action.at, { type: "merged", sha: action.sha, base: "main" })] };
    case "close":
      if (state.status !== "open") return state;
      return { ...next, status: "closed", timeline: [...state.timeline, event(id("closed"), action.at, { type: "closed" })] };
    case "reopen":
      if (state.status !== "closed") return state;
      return { ...next, status: "open", timeline: [...state.timeline, event(id("reopened"), action.at, { type: "reopened" })] };
    case "delete-branch":
      if (state.status === "open" || state.branchDeleted) return state;
      return { ...next, branchDeleted: true, timeline: [...state.timeline, event(id("deleted"), action.at, { type: "branch_deleted", branch: action.branch })] };
    case "restore-branch":
      if (!state.branchDeleted) return state;
      return { ...next, branchDeleted: false, timeline: [...state.timeline, event(id("restored"), action.at, { type: "branch_restored", branch: action.branch })] };
    case "subscribe":
      return { ...state, subscribed: action.subscribed };
  }
}

// ---- Selectors -------------------------------------------------------------------------

export function pendingCount(state: PrState): number {
  let count = 0;
  for (const thread of state.threads) for (const comment of thread.comments) if (comment.pending) count++;
  return count;
}

// A review that only comments needs words or line comments; approving needs neither.
export function canSubmitReview(state: PrState, kind: ReviewState, body: string): boolean {
  if (state.status !== "open") return false;
  if (kind === "approved") return true;
  return body.trim().length > 0 || pendingCount(state) > 0;
}

export function viewedCount(state: PrState, paths: string[]): number {
  return paths.filter((path) => state.viewed[path]).length;
}

// The Conversation tab's counter: comments in the timeline, review bodies and the
// submitted comments of every thread.
export function conversationCount(state: PrState): number {
  let count = 0;
  for (const item of state.timeline) {
    if (item.kind === "comment") count++;
    else if (item.kind === "review" && item.body) count++;
  }
  for (const thread of state.threads) for (const comment of thread.comments) if (!comment.pending) count++;
  return count;
}

// The threads on one file, by line ("R12", "L40"), oldest first.
export function threadsByLine(threads: ReviewThread[], path: string): Map<string, ReviewThread[]> {
  const map = new Map<string, ReviewThread[]>();
  for (const thread of threads) {
    if (thread.ref.path !== path) continue;
    const key = `${thread.ref.side}${thread.ref.line}`;
    map.set(key, [...(map.get(key) ?? []), thread]);
  }
  return map;
}

// What the merge box says about the reviews: a request for changes outweighs approvals.
export function reviewDecision(reviewers: Reviewer[]): "approved" | "changes_requested" | "review_required" {
  if (reviewers.some((reviewer) => reviewer.state === "changes_requested")) return "changes_requested";
  if (reviewers.some((reviewer) => reviewer.state === "approved")) return "approved";
  return "review_required";
}

// ---- Commits by day ----------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayLabel(at: number): string {
  const date = new Date(at);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

// "Commits on Oct 3, 2026": the commits grouped by the day they were made, oldest first.
export function commitsByDay(commits: Commit[]): { day: string; commits: Commit[] }[] {
  const groups: { day: string; commits: Commit[] }[] = [];
  for (const commit of [...commits].sort((a, b) => a.at - b.at)) {
    const day = dayLabel(commit.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.commits.push(commit);
    else groups.push({ day, commits: [commit] });
  }
  return groups;
}

// ---- Issues ------------------------------------------------------------------------------

export interface IssueState {
  status: "open" | "closed";
  reason: "completed" | "not_planned" | null;
  timeline: TimelineItem[];
  subscribed: boolean;
  seq: number;
}

export type IssueAction =
  | { type: "comment"; body: string; at: number; close?: "completed" | "not_planned" }
  | { type: "close"; reason: "completed" | "not_planned"; at: number }
  | { type: "reopen"; at: number }
  | { type: "subscribe"; subscribed: boolean };

export function initialIssueState(issue: Issue): IssueState {
  const closed = [...issue.timeline].reverse().find((item) => item.kind === "event" && item.event.type === "closed");
  const reason = closed && closed.kind === "event" && closed.event.type === "closed" ? (closed.event.reason ?? "completed") : null;
  return { status: issue.state, reason: issue.state === "closed" ? (reason ?? "completed") : null, timeline: issue.timeline, subscribed: true, seq: 0 };
}

export function issueReducer(state: IssueState, action: IssueAction): IssueState {
  const id = (prefix: string) => `${prefix}-local-${state.seq + 1}`;
  const next = { ...state, seq: state.seq + 1 };
  switch (action.type) {
    case "comment": {
      const body = action.body.trim();
      if (!body && !action.close) return state;
      const timeline = body ? [...state.timeline, { kind: "comment" as const, id: id("comment"), author: ME, at: action.at, body }] : state.timeline;
      if (!action.close || state.status === "closed") return { ...next, timeline };
      return { ...next, status: "closed", reason: action.close, timeline: [...timeline, event(id("closed"), action.at, { type: "closed", reason: action.close })] };
    }
    case "close":
      if (state.status === "closed") return state;
      return { ...next, status: "closed", reason: action.reason, timeline: [...state.timeline, event(id("closed"), action.at, { type: "closed", reason: action.reason })] };
    case "reopen":
      if (state.status === "open") return state;
      return { ...next, status: "open", reason: null, timeline: [...state.timeline, event(id("reopened"), action.at, { type: "reopened" })] };
    case "subscribe":
      return { ...state, subscribed: action.subscribed };
  }
}

export function commentCount(timeline: TimelineItem[]): number {
  return timeline.filter((item) => item.kind === "comment").length;
}
