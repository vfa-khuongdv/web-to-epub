// The Issues and Pull requests lists: the filter box (it reads "is:open label:bug" like the
// site's), Open / Closed toggles with their counts, Author and Label pickers, and one row
// per item — state icon, title, labels, "#482 opened 3 hours ago by …", checks, review,
// assignees and comment count. A title opens the item.

import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleDot,
  CircleSlash,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Milestone,
  MessageSquare,
  Search,
  Tag,
  X,
} from "lucide-react";
import { KeyboardEvent, ReactNode, useMemo, useRef, useState } from "react";
import { Avatar, BOX, BTN, BTN_PRIMARY, Blankslate, Counter, FOCUS, StatusIcon } from "../RepoChrome";
import { ALL_LABELS } from "./fakeData";
import { matchesQuery, parseQuery, stateCounts, withState } from "./query";
import { ListRow } from "./rows";
import { LabelChip, POPOVER, TimeAgo, escapeCloses, useOutsideClick } from "./ui";

function stateIcon(row: ListRow, kind: "pr" | "issue"): ReactNode {
  if (kind === "pr") {
    if (row.state === "merged") return <GitMerge size={16} className="text-repo-done" aria-label="Merged pull request" />;
    if (row.state === "closed") return <GitPullRequestClosed size={16} className="text-repo-danger" aria-label="Closed pull request" />;
    if (row.draft) return <GitPullRequestDraft size={16} className="text-repo-muted" aria-label="Draft pull request" />;
    return <GitPullRequest size={16} className="text-repo-success" aria-label="Open pull request" />;
  }
  if (row.state === "open") return <CircleDot size={16} className="text-repo-success" aria-label="Open issue" />;
  if (row.closedReason === "not_planned") return <CircleSlash size={16} className="text-repo-muted" aria-label="Closed as not planned" />;
  return <CircleCheck size={16} className="text-repo-done" aria-label="Closed as completed" />;
}

const REVIEW_TEXT = { approved: "Approved", changes_requested: "Changes requested", review_required: "Review required" };

function Picker({ label, title, options, onPick }: { label: string; title: string; options: { value: string; node: ReactNode }[]; onPick: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useOutsideClick(box, open, () => setOpen(false));
  const shown = options.filter((option) => option.value.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <div ref={box} className="relative" onKeyDown={open ? escapeCloses(() => setOpen(false), button) : undefined}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 rounded-md px-1 text-[14px] text-repo-muted hover:text-repo-fg ${FOCUS}`}
      >
        {label}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div role="dialog" aria-label={title} className={`${POPOVER} right-0 top-7 w-[300px]`}>
          <div className="flex items-center justify-between border-b border-repo-border-muted px-4 py-2">
            <b className="text-[12px]">{title}</b>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className={`text-repo-muted hover:text-repo-fg ${FOCUS}`}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="border-b border-repo-border-muted p-2">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              autoFocus
              aria-label={`Filter ${title.toLowerCase()}`}
              placeholder={`Filter ${label.toLowerCase()}s`}
              className="h-8 w-full rounded-md border border-repo-border bg-repo-input px-2 text-[14px] text-repo-fg placeholder:text-repo-muted focus:border-repo-focus focus:outline-none"
            />
          </div>
          <ul className="max-h-[280px] overflow-y-auto py-1">
            {shown.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-[14px] hover:bg-repo-btn-hover ${FOCUS}`}
                  onClick={() => {
                    onPick(option.value);
                    setOpen(false);
                  }}
                >
                  {option.node}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ItemList({
  kind,
  rows,
  query,
  onQuery,
  onOpen,
  now,
}: {
  kind: "pr" | "issue";
  rows: ListRow[];
  query: string;
  onQuery: (query: string) => void;
  onOpen: (number: number) => void;
  now: number;
}) {
  const parsed = useMemo(() => parseQuery(query), [query]);
  const shown = rows.filter((row) => matchesQuery(row, parsed));
  const counts = stateCounts(rows, parsed);
  const showing = parsed.state ?? "all";
  const authors = [...new Set(rows.map((row) => row.author))].sort();
  const [typed, setTyped] = useState(query);
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setTyped(query);
  }

  const setToken = (key: string, value: string) => {
    const rest = query
      .split(/\s+/)
      .filter((token) => token && !token.toLowerCase().startsWith(`${key}:`))
      .join(" ");
    onQuery(`${rest} ${key}:${value.includes(" ") ? `"${value}"` : value}`.trim());
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onQuery(typed);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setTyped(query);
      event.currentTarget.blur();
    }
  };

  const toggle = (value: "open" | "closed", count: number, icon: ReactNode, word: string) => (
    <button
      type="button"
      aria-pressed={showing === value}
      onClick={() => onQuery(withState(query, value))}
      className={`flex items-center gap-1.5 rounded-md text-[14px] ${FOCUS} ${showing === value ? "font-semibold text-repo-fg" : "text-repo-muted hover:text-repo-fg"}`}
    >
      {icon}
      {count} {word}
    </button>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[240px] flex-1">
          <span className={`${BTN} rounded-r-none`} aria-hidden="true">
            Filters
            <ChevronDown size={14} className="text-repo-muted" />
          </span>
          <label className="relative flex min-w-0 flex-1 items-center">
            <Search size={16} className="pointer-events-none absolute left-2 text-repo-muted" aria-hidden="true" />
            <input
              type="search"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={onKey}
              onBlur={() => typed !== query && onQuery(typed)}
              aria-label={kind === "pr" ? "Search all pull requests" : "Search all issues"}
              className="h-8 w-full min-w-0 rounded-r-md border border-l-0 border-repo-border bg-repo-subtle pl-8 pr-2 text-[14px] text-repo-fg focus:border-l focus:border-repo-focus focus:bg-repo-input focus:outline-2 focus:outline-offset-[-1px] focus:outline-repo-focus"
            />
          </label>
        </div>
        <span className="flex" aria-hidden="true">
          <span className={`${BTN} rounded-r-none`}>
            <Tag size={16} className="text-repo-muted" />
            Labels <Counter value={ALL_LABELS.length} />
          </span>
          <span className={`${BTN} rounded-l-none border-l-0`}>
            <Milestone size={16} className="text-repo-muted" />
            Milestones <Counter value={1} />
          </span>
        </span>
        <span className={BTN_PRIMARY} aria-hidden="true">
          {kind === "pr" ? "New pull request" : "New issue"}
        </span>
      </div>

      {query.trim() !== (kind === "pr" ? "is:pr is:open" : "is:issue is:open") && (
        <button type="button" onClick={() => onQuery(kind === "pr" ? "is:pr is:open" : "is:issue is:open")} className={`mb-4 flex items-center gap-2 text-[14px] font-semibold text-repo-muted hover:text-repo-accent ${FOCUS}`}>
          <span className="grid size-[18px] place-items-center rounded-md bg-repo-neutral-emphasis text-white">
            <X size={14} aria-hidden="true" />
          </span>
          Clear current search query, filters, and sorts
        </button>
      )}

      <div className={BOX}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-t-md border-b border-repo-border bg-repo-subtle px-4 py-3">
          {toggle("open", counts.open, kind === "pr" ? <GitPullRequest size={16} aria-hidden="true" /> : <CircleDot size={16} aria-hidden="true" />, "Open")}
          {toggle("closed", counts.closed, <Check size={16} aria-hidden="true" />, "Closed")}
          <span className="ml-auto flex flex-wrap items-center gap-4">
            <Picker
              label="Author"
              title="Filter by author"
              options={authors.map((login) => ({
                value: login,
                node: (
                  <>
                    <Avatar seed={login} size={20} />
                    <b>{login}</b>
                  </>
                ),
              }))}
              onPick={(value) => setToken("author", value)}
            />
            <Picker
              label="Label"
              title="Filter by label"
              options={ALL_LABELS.map((label) => ({ value: label.name, node: <LabelChip label={label} /> }))}
              onPick={(value) => setToken("label", value)}
            />
            {["Projects", "Milestones", ...(kind === "pr" ? ["Reviews"] : []), "Assignee", "Sort"].map((name) => (
              <span key={name} className="hidden items-center gap-1 text-[14px] text-repo-muted lg:flex" aria-hidden="true">
                {name}
                <ChevronDown size={14} />
              </span>
            ))}
          </span>
        </div>
        {shown.length === 0 ? (
          <Blankslate icon={kind === "pr" ? <GitPullRequest size={24} /> : <CircleDot size={24} />} title="No results matched your search.">
            Try a different filter, or clear the search.
          </Blankslate>
        ) : (
          <ul aria-label={kind === "pr" ? "Pull requests" : "Issues"}>
            {shown.map((row) => (
              <li key={row.number} className="flex gap-2 border-t border-repo-border-muted px-4 py-2 first:border-t-0 hover:bg-repo-hover">
                <span className="flex-none pt-1">{stateIcon(row, kind)}</span>
                <div className="min-w-0 flex-1">
                  <span className="mr-1 inline">
                    <button
                      type="button"
                      onClick={() => onOpen(row.number)}
                      className={`break-words text-left align-middle text-[16px] font-semibold text-repo-fg hover:text-repo-accent ${FOCUS}`}
                    >
                      {row.title}
                    </button>
                  </span>
                  {row.checks && (
                    <span className="mr-1 inline-block align-middle">
                      <StatusIcon status={row.checks} size={14} label={row.checks === "success" ? "All checks have passed" : "Some checks were not successful"} />
                    </span>
                  )}
                  {row.labels.map((label) => (
                    <span key={label.name} className="mr-1 inline-block align-middle">
                      <LabelChip label={label} />
                    </span>
                  ))}
                  <p className="mt-1 text-[12px] text-repo-muted">
                    #{row.number}{" "}
                    {row.state === "open" ? (
                      <>
                        opened <TimeAgo at={row.at} now={now} /> by {row.author}
                      </>
                    ) : (
                      <>
                        by {row.author} was {row.state === "merged" ? "merged" : "closed"} <TimeAgo at={row.endedAt ?? row.at} now={now} />
                      </>
                    )}
                    {row.draft && <> · Draft</>}
                    {row.review && <> · {REVIEW_TEXT[row.review]}</>}
                    {row.tasks && (
                      <>
                        {" "}
                        · {row.tasks.done} of {row.tasks.total} tasks
                      </>
                    )}
                  </p>
                </div>
                <span className="hidden w-[64px] flex-none justify-end pt-1 sm:flex">
                  {row.assignees.map((login) => (
                    <Avatar key={login} seed={login} size={20} />
                  ))}
                </span>
                <span className="hidden w-[48px] flex-none justify-end pt-1 text-[12px] text-repo-muted sm:flex">
                  {row.comments > 0 && (
                    <span className="flex items-center gap-1" title={`${row.comments} comments`}>
                      <MessageSquare size={14} aria-hidden="true" />
                      {row.comments}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-4 text-center text-[14px] text-repo-muted">
        <b>ProTip!</b> Type <kbd className="font-repo-mono">g</kbd> <kbd className="font-repo-mono">{kind === "pr" ? "p" : "i"}</kbd> on any page of the repository to come back to this list.
      </p>
    </div>
  );
}
