// The rows of the issue and pull request lists, worked out from the fake repository and
// whatever was done on the pages since (a pull request merged, an issue closed, comments
// written), so the list agrees with the page it leads to.

import { taskCount } from "./markdown";
import { IssueState, PrState, commentCount, initialIssueState, initialPrState, reviewDecision } from "./state";
import { Issue, IssueLabel, PullRequest, TimelineItem } from "./types";

export interface ListRow {
  number: number;
  title: string;
  author: string;
  at: number;
  state: "open" | "closed" | "merged";
  draft: boolean;
  closedReason: "completed" | "not_planned" | null;
  // When it was closed or merged.
  endedAt: number | null;
  labels: IssueLabel[];
  assignees: string[];
  comments: number;
  checks: "success" | "failure" | null;
  review: "approved" | "changes_requested" | "review_required" | null;
  tasks: { done: number; total: number } | null;
}

function endedAt(timeline: TimelineItem[]): number | null {
  for (let index = timeline.length - 1; index >= 0; index--) {
    const item = timeline[index];
    if (item.kind === "event" && (item.event.type === "merged" || item.event.type === "closed")) return item.at;
  }
  return null;
}

function tasks(body: string): { done: number; total: number } | null {
  const count = taskCount(body);
  return count.total > 0 ? count : null;
}

export function pullRow(pr: PullRequest, saved?: PrState): ListRow {
  const state = saved ?? initialPrState(pr);
  return {
    number: pr.number,
    title: pr.title,
    author: pr.author,
    at: pr.at,
    state: state.status,
    draft: state.draft,
    closedReason: null,
    endedAt: state.status === "open" ? null : endedAt(state.timeline),
    labels: pr.labels,
    assignees: pr.assignees,
    comments: commentCount(state.timeline) + state.threads.reduce((sum, thread) => sum + thread.comments.filter((comment) => !comment.pending).length, 0),
    checks: pr.checks.some((check) => check.status === "failure") ? "failure" : "success",
    review: state.status === "open" && !state.draft ? reviewDecision(state.reviewers) : null,
    tasks: tasks(pr.body),
  };
}

export function issueRow(issue: Issue, saved?: IssueState): ListRow {
  const state = saved ?? initialIssueState(issue);
  return {
    number: issue.number,
    title: issue.title,
    author: issue.author,
    at: issue.at,
    state: state.status,
    draft: false,
    closedReason: state.status === "closed" ? state.reason : null,
    endedAt: state.status === "closed" ? endedAt(state.timeline) : null,
    labels: issue.labels,
    assignees: issue.assignees,
    comments: commentCount(state.timeline),
    checks: null,
    review: null,
    tasks: tasks(issue.body),
  };
}

// Newest first, as the list sorts by default.
export function newestFirst(rows: ListRow[]): ListRow[] {
  return [...rows].sort((a, b) => b.at - a.at);
}
