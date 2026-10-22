// The discussion sidebar beside a pull request or an issue: reviewers with how each one
// reviewed, assignees, labels, project, milestone, linked work, notifications (the one
// switch that answers) and the participants.

import { Check, CircleDot, Eye, FileDiff, GitPullRequest, MessageSquare, Settings } from "lucide-react";
import { ReactNode } from "react";
import { Avatar, BTN, FOCUS } from "../RepoChrome";
import { IssueLabel, Milestone, Reviewer } from "./types";
import { LabelChip } from "./ui";

function Section({ title, children, last = false }: { title: string; children: ReactNode; last?: boolean }) {
  return (
    <section className={`py-4 first:pt-0 ${last ? "" : "border-b border-repo-border-muted"}`}>
      <h2 className="mb-2 flex items-center justify-between text-[12px] font-semibold text-repo-muted">
        {title}
        <Settings size={16} aria-hidden="true" />
      </h2>
      <div className="text-[12px] text-repo-muted">{children}</div>
    </section>
  );
}

function Person({ login, after }: { login: string; after?: ReactNode }) {
  return (
    <p className="mb-1.5 flex items-center gap-2 text-[14px] text-repo-fg last:mb-0">
      <Avatar seed={login} size={20} />
      <b className="min-w-0 flex-1 truncate">{login}</b>
      {after}
    </p>
  );
}

const REVIEW_MARK: Record<Reviewer["state"], ReactNode> = {
  approved: <Check size={16} className="text-repo-success" aria-label="Approved" />,
  changes_requested: <FileDiff size={16} className="text-repo-danger" aria-label="Changes requested" />,
  commented: <MessageSquare size={16} className="text-repo-muted" aria-label="Left review comments" />,
  requested: <span className="size-2 rounded-full bg-repo-attention-dot" aria-label="Awaiting review" />,
};

export function Sidebar({
  reviewers,
  assignees,
  labels,
  project,
  milestone,
  development,
  participants,
  subscribed,
  onSubscribe,
  kind,
}: {
  reviewers: Reviewer[] | null;
  assignees: string[];
  labels: IssueLabel[];
  project: string | null;
  milestone: Milestone | null;
  development: ReactNode;
  participants: string[];
  subscribed: boolean;
  onSubscribe: (subscribed: boolean) => void;
  kind: "pr" | "issue";
}) {
  return (
    <aside className="text-[12px]" aria-label="Details">
      {reviewers && (
        <Section title="Reviewers">
          {reviewers.length === 0 ? (
            <p>No reviews</p>
          ) : (
            reviewers.map((reviewer) => <Person key={reviewer.login} login={reviewer.login} after={REVIEW_MARK[reviewer.state]} />)
          )}
        </Section>
      )}
      <Section title="Assignees">
        {assignees.length === 0 ? <p>No one assigned</p> : assignees.map((login) => <Person key={login} login={login} />)}
      </Section>
      <Section title="Labels">
        {labels.length === 0 ? (
          <p>None yet</p>
        ) : (
          <span className="flex flex-wrap gap-1">
            {labels.map((label) => (
              <LabelChip key={label.name} label={label} />
            ))}
          </span>
        )}
      </Section>
      <Section title="Projects">
        {project ? (
          <span className="block rounded-md border border-repo-border px-2 py-1.5">
            <b className="block text-[12px] text-repo-fg">{project}</b>
            <span className="mt-0.5 flex items-center gap-1">
              Status: <span className="text-repo-fg">{kind === "pr" ? "In review" : "In progress"}</span>
            </span>
          </span>
        ) : (
          <p>None yet</p>
        )}
      </Section>
      <Section title="Milestone">
        {milestone ? (
          <>
            <span className="block h-2 overflow-hidden rounded-full bg-repo-counter" aria-hidden="true">
              <span className="block h-full bg-repo-success-btn" style={{ width: `${Math.round(milestone.progress * 100)}%` }} />
            </span>
            <b className="mt-1.5 block text-[14px] text-repo-fg">{milestone.title}</b>
          </>
        ) : (
          <p>No milestone</p>
        )}
      </Section>
      <Section title="Development">{development}</Section>
      <section className="border-b border-repo-border-muted py-4">
        <h2 className="mb-2 flex items-center justify-between text-[12px] font-semibold text-repo-muted">
          Notifications
          <span>Customize</span>
        </h2>
        <button type="button" className={`${BTN} h-7 w-full text-[12px] ${FOCUS}`} onClick={() => onSubscribe(!subscribed)}>
          <Eye size={14} className="text-repo-muted" aria-hidden="true" />
          {subscribed ? "Unsubscribe" : "Subscribe"}
        </button>
        <p className="mt-2 text-repo-muted">
          {subscribed
            ? `You're receiving notifications because you're watching this repository.`
            : `You're not receiving notifications from this ${kind === "pr" ? "pull request" : "issue"}.`}
        </p>
      </section>
      <section className="py-4">
        <h2 className="mb-2 text-[12px] font-semibold text-repo-muted">{participants.length} participants</h2>
        <span className="flex flex-wrap gap-1">
          {participants.map((login) => (
            <Avatar key={login} seed={login} size={26} />
          ))}
        </span>
      </section>
    </aside>
  );
}

// "Development": the issues a pull request closes, or the pull requests that close an
// issue. A row opens the item when the page can go there (the shell), and is text in the
// decoy.
export function LinkedItems({
  intro,
  items,
  onOpen,
}: {
  intro: string;
  items: { kind: "pr" | "issue"; number: number; title: string }[];
  onOpen?: (kind: "pr" | "issue", number: number) => void;
}) {
  if (items.length === 0) return <p>{intro}</p>;
  return (
    <>
      <p className="mb-1.5">{intro}</p>
      {items.map((item) => {
        const icon = item.kind === "pr" ? <GitPullRequest size={14} className="flex-none text-repo-success" aria-hidden="true" /> : <CircleDot size={14} className="flex-none text-repo-success" aria-hidden="true" />;
        const text = (
          <>
            <span className="min-w-0 truncate font-semibold text-repo-fg">{item.title}</span>
            <span className="flex-none">#{item.number}</span>
          </>
        );
        return onOpen ? (
          <button
            key={item.number}
            type="button"
            onClick={() => onOpen(item.kind, item.number)}
            className={`mb-1 flex w-full items-center gap-1.5 text-left text-[12px] hover:text-repo-accent ${FOCUS}`}
          >
            {icon}
            {text}
          </button>
        ) : (
          <p key={item.number} className="mb-1 flex items-center gap-1.5 text-[12px]">
            {icon}
            {text}
          </p>
        );
      })}
    </>
  );
}
