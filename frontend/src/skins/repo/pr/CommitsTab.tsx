// The Commits tab: "Commits on Oct 5, 2026" groups on the timeline line, one boxed list per
// day — message, author and time, check status, and the short hash with its copy button.

import { Code, Copy, GitCommitHorizontal } from "lucide-react";
import { useState } from "react";
import { Avatar, FOCUS, StatusIcon } from "../RepoChrome";
import { commitsByDay } from "./state";
import { Commit } from "./types";
import { TimeAgo } from "./ui";

export function CommitsTab({ commits, now }: { commits: Commit[]; now: number }) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="relative before:absolute before:inset-y-0 before:left-[15px] before:w-0.5 before:bg-repo-border-muted">
      {commitsByDay(commits).map((group) => (
        <section key={group.day} className="relative pb-4">
          <h3 className="relative flex items-center gap-2 py-2 text-[14px] text-repo-muted">
            <span className="grid size-8 place-items-center bg-repo-canvas" aria-hidden="true">
              <GitCommitHorizontal size={16} />
            </span>
            Commits on {group.day}
          </h3>
          <ul className="relative ml-8 rounded-md border border-repo-border bg-repo-canvas sm:ml-10">
            {group.commits.map((commit) => (
              <li key={commit.sha} className="flex items-center gap-3 border-t border-repo-border-muted px-4 py-2 first:border-t-0 hover:bg-repo-hover">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold text-repo-fg">{commit.message}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-[12px] text-repo-muted">
                    <Avatar seed={commit.author} size={16} />
                    <b className="text-repo-fg">{commit.author}</b> committed <TimeAgo at={commit.at} now={now} />
                    <StatusIcon status={commit.status} size={14} label={commit.status === "success" ? "All checks have passed" : "Some checks were not successful"} />
                  </p>
                </div>
                <span className="flex flex-none items-center rounded-md border border-repo-border">
                  <code className="px-2 font-repo-mono text-[12px] leading-[26px]">{commit.sha}</code>
                  <button
                    type="button"
                    aria-label={copied === commit.sha ? "Copied!" : "Copy full SHA"}
                    title={copied === commit.sha ? "Copied!" : "Copy full SHA"}
                    onClick={() => setCopied(commit.sha)}
                    className={`grid h-[26px] w-7 place-items-center border-l border-repo-border text-repo-muted hover:bg-repo-btn-hover ${FOCUS}`}
                  >
                    <Copy size={14} aria-hidden="true" />
                  </button>
                </span>
                <span className="hidden size-7 flex-none place-items-center rounded-md border border-repo-border text-repo-muted sm:grid" aria-hidden="true">
                  <Code size={14} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
