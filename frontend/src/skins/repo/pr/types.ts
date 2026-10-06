// The code-hosting skin's pull requests and issues as plain data: what the fake team's
// repository holds (pr/fakeData.ts) and what the pages draw (pr/*.tsx). Times are epoch
// milliseconds, worked out from "now" when the data is made, so the page always reads
// "3 hours ago" whenever it is opened.

import { Hunk } from "./diff";

// Who is looking: the avatar in the header. Comments written on the page are theirs.
export const ME = "dev";

export type LabelTone = "red" | "orange" | "yellow" | "green" | "blue" | "cyan" | "purple" | "gray";

export interface IssueLabel {
  name: string;
  tone: LabelTone;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  at: number;
  status: "success" | "failure";
}

export interface CheckStep {
  name: string;
  seconds: number;
  log: string[];
}

export interface CheckJob {
  id: string;
  workflow: string;
  name: string;
  status: "success" | "failure";
  seconds: number;
  at: number;
  steps: CheckStep[];
}

export type FileStatus = "added" | "modified" | "removed";

export interface ChangedFile {
  path: string;
  status: FileStatus;
  hunks: Hunk[];
}

// A line a review comment hangs on: "L" is the old side (a removed line), "R" the new one.
export interface LineRef {
  path: string;
  side: "L" | "R";
  line: number;
}

export interface ThreadComment {
  id: string;
  author: string;
  body: string;
  at: number;
  // Written as part of a review that is not submitted yet.
  pending: boolean;
}

export interface ReviewThread {
  id: string;
  ref: LineRef;
  comments: ThreadComment[];
  resolved: boolean;
}

export type ReviewState = "commented" | "approved" | "changes_requested";

export interface Reviewer {
  login: string;
  state: ReviewState | "requested";
}

export type TimelineEvent =
  | { type: "labeled"; labels: string[] }
  | { type: "assigned"; who: string }
  | { type: "review_requested"; who: string }
  | { type: "referenced"; number: number; title: string }
  | { type: "milestoned"; milestone: string }
  | { type: "merged"; sha: string; base: string }
  | { type: "closed"; reason?: "completed" | "not_planned" }
  | { type: "reopened" }
  | { type: "branch_deleted"; branch: string }
  | { type: "branch_restored"; branch: string }
  | { type: "ready" };

export type TimelineItem =
  | { kind: "comment"; id: string; author: string; at: number; body: string }
  | { kind: "commits"; id: string; author: string; at: number; shas: string[] }
  | { kind: "review"; id: string; author: string; at: number; state: ReviewState; body: string; threadIds: string[] }
  | { kind: "event"; id: string; author: string; at: number; event: TimelineEvent };

export interface Milestone {
  title: string;
  // 0..1
  progress: number;
}

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  at: number;
  base: string;
  head: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  // Markdown (pr/markdown.ts).
  body: string;
  labels: IssueLabel[];
  assignees: string[];
  reviewers: Reviewer[];
  milestone: Milestone | null;
  project: string | null;
  closes: number[];
  commits: Commit[];
  checks: CheckJob[];
  files: ChangedFile[];
  timeline: TimelineItem[];
  threads: ReviewThread[];
}

export interface Issue {
  number: number;
  title: string;
  author: string;
  at: number;
  state: "open" | "closed";
  body: string;
  labels: IssueLabel[];
  assignees: string[];
  milestone: Milestone | null;
  project: string | null;
  timeline: TimelineItem[];
}
