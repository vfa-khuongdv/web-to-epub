// The discussion timeline of a pull request or an issue: comment boxes with the avatar
// beside them, small events on the vertical line (labels, reviews requested, merges,
// closing), pushed commits, and reviews with the line conversations they opened.

import {
  Check,
  CircleCheck,
  CircleDot,
  CircleSlash,
  Ellipsis,
  Eye,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Link2,
  Milestone,
  Smile,
  Tag,
  UserRound,
} from "lucide-react";
import { ReactNode } from "react";
import { Avatar, Label, StatusIcon } from "../RepoChrome";
import { quotedLines } from "./diff";
import { languageOf } from "./highlight";
import { PrAction } from "./state";
import { ThreadView } from "./Thread";
import { ALL_LABELS } from "./fakeData";
import { ChangedFile, Commit, ME, ReviewThread, TimelineEvent, TimelineItem } from "./types";
import { LabelChip, Markdown, TimeAgo } from "./ui";

// The vertical line every event sits on: 72px in with avatars, 16px without.
export const TIMELINE = "relative before:absolute before:inset-y-0 before:left-4 before:w-0.5 before:bg-repo-border-muted sm:before:left-[72px]";
const INDENT = "ml-4 sm:ml-[72px]";

export function TimelineComment({
  author,
  at,
  now,
  role,
  children,
  action = "commented",
}: {
  author: string;
  at: number;
  now: number;
  role: string | null;
  children: ReactNode;
  action?: string;
}) {
  const mine = author === ME;
  return (
    <div className="relative mb-4 sm:pl-14">
      <span className="absolute left-0 top-0 hidden sm:block">
        <Avatar seed={author} size={40} />
      </span>
      <div className={`relative rounded-md border bg-repo-canvas ${mine ? "border-repo-mine-rule" : "border-repo-border"}`}>
        <span
          aria-hidden="true"
          className={`absolute left-[-6px] top-[14px] hidden size-[11px] rotate-45 border-b border-l sm:block ${
            mine ? "border-repo-mine-rule bg-repo-mine" : "border-repo-border bg-repo-subtle"
          }`}
        />
        <div
          className={`flex min-h-[40px] flex-wrap items-center gap-x-1 rounded-t-md border-b px-4 py-2 text-[14px] text-repo-muted ${
            mine ? "border-repo-mine-rule bg-repo-mine" : "border-repo-border bg-repo-subtle"
          }`}
        >
          <b className="text-repo-fg">{author}</b>
          <span>
            {action} <TimeAgo at={at} now={now} />
          </span>
          <span className="ml-auto flex items-center gap-2">
            {role && <Label>{role}</Label>}
            <span aria-hidden="true">
              <Ellipsis size={16} />
            </span>
          </span>
        </div>
        <div className="px-4 py-4">{children}</div>
        <div className="px-4 pb-4" aria-hidden="true">
          <span className="inline-grid size-7 place-items-center rounded-full border border-repo-border text-repo-muted">
            <Smile size={16} />
          </span>
        </div>
      </div>
    </div>
  );
}

type BadgeTone = "plain" | "success" | "danger" | "done" | "neutral";
const BADGE: Record<BadgeTone, string> = {
  plain: "bg-repo-badge text-repo-muted",
  success: "bg-repo-success-btn text-white",
  danger: "bg-repo-danger-emphasis text-white",
  done: "bg-repo-done-emphasis text-white",
  neutral: "bg-repo-neutral-emphasis text-white",
};

export function TimelineRow({ icon, tone = "plain", children }: { icon: ReactNode; tone?: BadgeTone; children: ReactNode }) {
  return (
    <div className={`relative flex items-start py-3 ${INDENT}`}>
      <span className={`-ml-4 mr-2 grid size-8 flex-none place-items-center rounded-full border-2 border-repo-canvas ${BADGE[tone]}`} aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-1 text-[14px] text-repo-muted">{children}</div>
    </div>
  );
}

function Who({ login }: { login: string }) {
  return (
    <>
      <span className="mr-1 inline-block align-middle">
        <Avatar seed={login} size={20} />
      </span>
      <b className="text-repo-fg">{login}</b>
    </>
  );
}

function eventLine(event: TimelineEvent, kind: "pr" | "issue"): { icon: ReactNode; tone: BadgeTone; text: ReactNode } {
  switch (event.type) {
    case "labeled":
      return {
        icon: <Tag size={16} />,
        tone: "plain",
        text: (
          <>
            added{" "}
            {event.labels.map((name) => {
              const label = ALL_LABELS.find((candidate) => candidate.name === name) ?? { name, tone: "gray" as const };
              return (
                <span key={name} className="mr-1 inline-block align-middle">
                  <LabelChip label={label} />
                </span>
              );
            })}
            {event.labels.length === 1 ? "label" : "labels"}
          </>
        ),
      };
    case "assigned":
      return { icon: <UserRound size={16} />, tone: "plain", text: <>assigned <b className="text-repo-fg">{event.who}</b></> };
    case "review_requested":
      return { icon: <Eye size={16} />, tone: "plain", text: <>requested a review from <b className="text-repo-fg">{event.who}</b></> };
    case "referenced":
      return {
        icon: <Link2 size={16} />,
        tone: "plain",
        text: (
          <>
            mentioned this in <b className="text-repo-fg">{event.title}</b> <span className="text-repo-muted">#{event.number}</span>
          </>
        ),
      };
    case "milestoned":
      return { icon: <Milestone size={16} />, tone: "plain", text: <>added this to the <b className="text-repo-fg">{event.milestone}</b> milestone</> };
    case "merged":
      return {
        icon: <GitMerge size={16} />,
        tone: "done",
        text: (
          <>
            merged commit <code className="font-repo-mono text-[12px] text-repo-fg">{event.sha}</code> into <b className="font-repo-mono text-[12px] text-repo-fg">{event.base}</b>
          </>
        ),
      };
    case "closed":
      if (kind === "pr") return { icon: <GitPullRequestClosed size={16} />, tone: "danger", text: <>closed this</> };
      return event.reason === "not_planned"
        ? { icon: <CircleSlash size={16} />, tone: "neutral", text: <>closed this as not planned</> }
        : { icon: <CircleCheck size={16} />, tone: "done", text: <>closed this as completed</> };
    case "reopened":
      return { icon: kind === "pr" ? <GitPullRequest size={16} /> : <CircleDot size={16} />, tone: "success", text: <>reopened this</> };
    case "branch_deleted":
      return { icon: <GitBranch size={16} />, tone: "neutral", text: <>deleted the <code className="font-repo-mono text-[12px] text-repo-fg">{event.branch}</code> branch</> };
    case "branch_restored":
      return { icon: <GitBranch size={16} />, tone: "plain", text: <>restored the <code className="font-repo-mono text-[12px] text-repo-fg">{event.branch}</code> branch</> };
    case "ready":
      return { icon: <Eye size={16} />, tone: "plain", text: <>marked this pull request as ready for review</> };
  }
}

const REVIEW_LINE = {
  commented: { icon: <Eye size={16} />, tone: "plain" as BadgeTone, text: "reviewed" },
  approved: { icon: <Check size={16} strokeWidth={2.5} />, tone: "success" as BadgeTone, text: "approved these changes" },
  changes_requested: { icon: <FileDiff size={16} />, tone: "danger" as BadgeTone, text: "requested changes" },
};

export function Timeline({
  items,
  kind,
  author,
  now,
  threads = [],
  files = [],
  commits = [],
  reviewing = false,
  dispatch,
}: {
  items: TimelineItem[];
  kind: "pr" | "issue";
  // The pull request's or issue's author, labelled "Author" on their comments.
  author: string;
  now: number;
  threads?: ReviewThread[];
  files?: ChangedFile[];
  commits?: Commit[];
  reviewing?: boolean;
  dispatch?: (action: PrAction) => void;
}) {
  const role = (login: string) => (login === author ? "Author" : "Member");
  return (
    <>
      {items.map((item) => {
        switch (item.kind) {
          case "comment":
            return (
              <TimelineComment key={item.id} author={item.author} at={item.at} now={now} role={role(item.author)}>
                <Markdown source={item.body} />
              </TimelineComment>
            );
          case "commits": {
            const list = item.shas.map((sha) => commits.find((commit) => commit.sha === sha)).filter((commit): commit is Commit => !!commit);
            return (
              <div key={item.id}>
                <TimelineRow icon={<GitCommitHorizontal size={16} />}>
                  <Who login={item.author} /> added {list.length} {list.length === 1 ? "commit" : "commits"} <TimeAgo at={item.at} now={now} />
                </TimelineRow>
                {list.map((commit) => (
                  <div key={commit.sha} className={`relative -mt-1 flex items-center gap-2 pb-2 pr-2 text-[14px] ${INDENT}`}>
                    <span className="-ml-2 grid size-4 flex-none place-items-center bg-repo-canvas text-repo-muted" aria-hidden="true">
                      <GitCommitHorizontal size={14} />
                    </span>
                    <Avatar seed={commit.author} size={20} />
                    <span className="min-w-0 flex-1 truncate text-repo-fg">{commit.message}</span>
                    <StatusIcon status={commit.status} size={14} />
                    <code className="flex-none font-repo-mono text-[12px] text-repo-muted">{commit.sha}</code>
                  </div>
                ))}
              </div>
            );
          }
          case "review": {
            const line = REVIEW_LINE[item.state];
            const opened = item.threadIds.map((id) => threads.find((thread) => thread.id === id)).filter((thread): thread is ReviewThread => !!thread);
            return (
              <div key={item.id}>
                <TimelineRow icon={line.icon} tone={line.tone}>
                  <Who login={item.author} /> {line.text} <TimeAgo at={item.at} now={now} />
                </TimelineRow>
                {(item.body || opened.length > 0) && (
                  <div className="relative mb-4 ml-8 space-y-3 sm:ml-[88px]">
                    {item.body && (
                      <div className={`rounded-md border bg-repo-canvas px-4 py-3 ${item.author === ME ? "border-repo-mine-rule" : "border-repo-border"}`}>
                        <Markdown source={item.body} />
                      </div>
                    )}
                    {opened.map((thread) => {
                      const file = files.find((candidate) => candidate.path === thread.ref.path);
                      return (
                        <ThreadView
                          key={thread.id}
                          thread={thread}
                          reviewing={reviewing}
                          now={now}
                          dispatch={dispatch ?? (() => {})}
                          canResolve={!!dispatch}
                          quote={{
                            path: thread.ref.path,
                            lines: file ? quotedLines(file.hunks, thread.ref.side, thread.ref.line) : [],
                            language: languageOf(thread.ref.path),
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          case "event": {
            const line = eventLine(item.event, kind);
            return (
              <TimelineRow key={item.id} icon={line.icon} tone={line.tone}>
                <Who login={item.author} /> {line.text} <TimeAgo at={item.at} now={now} />
              </TimelineRow>
            );
          }
        }
      })}
    </>
  );
}
