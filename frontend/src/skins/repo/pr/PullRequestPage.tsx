// A pull request page, the same for the shell's Pull requests tab and the boss key's decoy:
// title and number, the state badge and "wants to merge N commits into main from …", the
// Edit and Code buttons, then the Conversation / Commits / Checks / Files changed tabs.
// Its state (comments, reviews, viewed files, merge) is in memory only: the caller may
// keep it between visits through `saved` / `onSave`.

import { ChevronDown, Code, Copy, FileDiff, GitCommitHorizontal, ListChecks, MessageSquare } from "lucide-react";
import { ReactNode, useEffect, useReducer, useRef, useState } from "react";
import { BTN, BTN_PRIMARY, Counter, FOCUS, INPUT } from "../RepoChrome";
import { changeCounts } from "./diff";
import { ChecksTab } from "./ChecksTab";
import { CommitsTab } from "./CommitsTab";
import { ConversationTab } from "./ConversationTab";
import { FilesTab } from "./FilesTab";
import { PrState, conversationCount, initialPrState, prReducer } from "./state";
import { ME, PullRequest } from "./types";
import { BranchName, Diffstat, StateBadge, TimeAgo } from "./ui";

export type PrTab = "conversation" | "commits" | "checks" | "files";

export function PullRequestPage({
  pr,
  now,
  saved,
  onSave,
  initialTab = "conversation",
  development,
  onTitle,
}: {
  pr: PullRequest;
  now: number;
  saved?: PrState;
  onSave?: (state: PrState) => void;
  initialTab?: PrTab;
  // The sidebar's "Development" section (the issues this closes).
  development?: ReactNode;
  // A renamed title, reported so the page's caller can show it (the tab title).
  onTitle?: (title: string) => void;
}) {
  const [state, dispatch] = useReducer(prReducer, pr, (initial) => saved ?? initialPrState(initial));
  const [tab, setTab] = useState<PrTab>(initialTab);
  const [job, setJob] = useState(pr.checks[0]?.id ?? "");
  const [title, setTitle] = useState(pr.title);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(pr.title);
  const top = useRef<HTMLDivElement>(null);
  const save = useRef(onSave);
  save.current = onSave;

  useEffect(() => {
    save.current?.(state);
  }, [state]);

  const totals = pr.files.reduce(
    (sum, file) => {
      const counts = changeCounts(file.hunks);
      return { additions: sum.additions + counts.additions, deletions: sum.deletions + counts.deletions };
    },
    { additions: 0, deletions: 0 }
  );
  const failing = pr.checks.some((check) => check.status === "failure");
  const merged = state.status === "merged";
  const mergedEvent = [...state.timeline].reverse().find((item) => item.kind === "event" && item.event.type === "merged");
  const badge = merged ? "merged" : state.status === "closed" ? "closed" : state.draft ? "draft" : "open";
  const commitWord = `${pr.commits.length} ${pr.commits.length === 1 ? "commit" : "commits"}`;

  const go = (next: PrTab) => {
    setTab(next);
    top.current?.scrollIntoView({ block: "start" });
  };

  const tabs: { id: PrTab; label: string; icon: ReactNode; count: number }[] = [
    { id: "conversation", label: "Conversation", icon: <MessageSquare size={16} />, count: conversationCount(state) },
    { id: "commits", label: "Commits", icon: <GitCommitHorizontal size={16} />, count: pr.commits.length },
    { id: "checks", label: "Checks", icon: <ListChecks size={16} />, count: pr.checks.length },
    { id: "files", label: "Files changed", icon: <FileDiff size={16} />, count: pr.files.length },
  ];

  return (
    <div ref={top} className={`mx-auto w-full px-4 pt-6 md:px-6 ${tab === "files" ? "max-w-none" : "max-w-[1280px]"}`}>
      {editing ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            aria-label="Title"
            className={`${INPUT} h-10 min-w-0 flex-1 text-[20px]`}
            value={draftTitle}
            autoFocus
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
          />
          <button
            type="button"
            className={BTN}
            disabled={!draftTitle.trim()}
            onClick={() => {
              setTitle(draftTitle.trim());
              onTitle?.(draftTitle.trim());
              setEditing(false);
            }}
          >
            Save
          </button>
          <button type="button" className={`text-[14px] text-repo-accent hover:underline ${FOCUS}`} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="mb-2 flex flex-wrap items-start gap-2 md:flex-nowrap">
          <h1 className="min-w-0 flex-1 break-words text-[26px] font-normal leading-[1.25] md:text-[32px]">
            <bdi>{title}</bdi> <span className="font-light text-repo-muted">#{pr.number}</span>
          </h1>
          <span className="flex flex-none gap-2 md:pt-1">
            <button
              type="button"
              className={`${BTN} h-7 px-3 text-[12px]`}
              onClick={() => {
                setDraftTitle(title);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <span className={`${BTN_PRIMARY} h-7 px-3 text-[12px]`} aria-hidden="true">
              <Code size={14} />
              Code
              <ChevronDown size={14} />
            </span>
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pb-4 text-[14px] text-repo-muted">
        <StateBadge state={badge} kind="pr" />
        <span className="min-w-0">
          {merged ? (
            <>
              <b className="text-repo-fg">{mergedEvent?.author ?? ME}</b> merged {commitWord} into <BranchName>{pr.base}</BranchName> from{" "}
              <BranchName>{pr.head}</BranchName> {mergedEvent && <TimeAgo at={mergedEvent.at} now={now} />}
            </>
          ) : (
            <>
              <b className="text-repo-fg">{pr.author}</b> wants to merge {commitWord} into <BranchName>{pr.base}</BranchName> from{" "}
              <BranchName>{pr.head}</BranchName>
            </>
          )}
        </span>
        <span className="text-repo-muted" aria-hidden="true">
          <Copy size={14} />
        </span>
      </div>

      <div className="flex flex-wrap items-end border-b border-repo-border">
        <nav aria-label="Pull request" className="-mb-px flex max-w-full overflow-x-auto [scrollbar-width:none]">
          {tabs.map((item) => {
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => go(item.id)}
                className={`flex flex-none items-center gap-2 whitespace-nowrap rounded-t-md border px-4 py-2 text-[14px] leading-[23px] ${FOCUS} ${
                  active ? "border-repo-border border-b-repo-canvas bg-repo-canvas text-repo-fg" : "border-transparent text-repo-muted hover:text-repo-fg"
                }`}
              >
                <span className="text-repo-muted" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
                <Counter value={item.count} />
                {item.id === "checks" && failing && <span className="size-2 rounded-full bg-repo-danger" aria-label="failing" />}
              </button>
            );
          })}
        </nav>
        <span className="ml-auto hidden pb-2 sm:block">
          <Diffstat additions={totals.additions} deletions={totals.deletions} />
        </span>
      </div>

      <div className="pb-10 pt-6">
        {tab === "conversation" && (
          <ConversationTab
            pr={pr}
            state={state}
            dispatch={dispatch}
            now={now}
            development={development ?? <p>No linked issues</p>}
            onDetails={(id) => {
              setJob(id);
              go("checks");
            }}
          />
        )}
        {tab === "commits" && <CommitsTab commits={pr.commits} now={now} />}
        {tab === "checks" && <ChecksTab key={job} checks={pr.checks} now={now} selected={job} onSelect={setJob} />}
        {tab === "files" && <FilesTab pr={pr} state={state} dispatch={dispatch} now={now} onSubmitted={() => go("conversation")} />}
      </div>
    </div>
  );
}
