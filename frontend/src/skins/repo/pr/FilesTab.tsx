// The Files changed tab: the toolbar (file filter, jump to, diff settings, "x / y files
// viewed", Review changes), the changed files as a collapsible tree with a filter box,
// and one box per file — collapsible, "Viewed" to tick, its diff unified or split with
// comments on lines. "Review changes" finishes a review: a summary, Comment / Approve /
// Request changes, and Submit review, which lands in the conversation.

import {
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  File,
  FileDiff,
  FileMinus,
  FilePlus,
  Folder,
  FolderOpen,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  X,
} from "lucide-react";
import { MouseEvent, ReactNode, useMemo, useRef, useState } from "react";
import { BTN, BTN_PRIMARY, FOCUS, INPUT } from "../RepoChrome";
import { CommentForm } from "./CommentForm";
import { TreeNode, buildTree, changeCounts, filterTree, treeFiles } from "./diff";
import { DiffMode, DiffView } from "./DiffView";
import { PrAction, PrState, canSubmitReview, pendingCount, threadsByLine, viewedCount } from "./state";
import { ChangedFile, ME, PullRequest, ReviewState } from "./types";
import { Diffstat, POPOVER, escapeCloses, useOutsideClick } from "./ui";

const MODE_KEY = "repo-diff-mode";
// The toolbar's height: file headers stick just under it.
const BAR = "top-[52px]";

function readMode(): DiffMode {
  try {
    return localStorage.getItem(MODE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

const STATUS_ICON: Record<ChangedFile["status"], ReactNode> = {
  added: <FilePlus size={16} className="text-repo-success" aria-label="added" />,
  modified: <FileDiff size={16} className="text-repo-attention" aria-label="modified" />,
  removed: <FileMinus size={16} className="text-repo-danger" aria-label="removed" />,
};

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "No extension";
};

// A drop-down button of the toolbar with its popover.
function Dropdown({ label, children, align = "left", title }: { label: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; title: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useOutsideClick(box, open, () => setOpen(false));
  return (
    <div ref={box} className="relative" onKeyDown={open ? escapeCloses(() => setOpen(false), button) : undefined}>
      <button ref={button} type="button" className={`${BTN} h-7 px-2 text-[12px]`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        {label}
        <ChevronDown size={14} className="text-repo-muted" aria-hidden="true" />
      </button>
      {open && (
        <div role="dialog" aria-label={title} className={`${POPOVER} top-9 w-[280px] ${align === "right" ? "right-0" : "left-0"} py-2`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function ReviewPopover({
  state,
  dispatch,
  author,
  onSubmitted,
}: {
  state: PrState;
  dispatch: (action: PrAction) => void;
  author: string;
  onSubmitted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReviewState>("commented");
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useOutsideClick(box, open, () => setOpen(false));
  const pending = pendingCount(state);
  const own = author === ME;
  const closed = state.status !== "open";
  const options: { value: ReviewState; title: string; text: string; disabled: boolean }[] = [
    { value: "commented", title: "Comment", text: "Submit general feedback without explicit approval.", disabled: false },
    { value: "approved", title: "Approve", text: "Give your approval to merge these changes.", disabled: own },
    { value: "changes_requested", title: "Request changes", text: "Submit feedback that must be addressed before merging.", disabled: own },
  ];
  return (
    <div ref={box} className="relative" onKeyDown={open ? escapeCloses(() => setOpen(false), button) : undefined}>
      <button
        ref={button}
        type="button"
        className={`${BTN_PRIMARY} h-7 px-3 text-[12px]`}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={closed}
        onClick={() => setOpen(!open)}
      >
        {pending > 0 ? "Finish your review" : "Review changes"}
        {pending > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[12px] leading-[18px]">{pending}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div role="dialog" aria-label="Finish your review" className={`${POPOVER} right-0 top-9 w-[min(640px,calc(100vw-32px))]`}>
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <h3 className="text-[14px] font-semibold">Finish your review</h3>
            <button type="button" aria-label="Close" className={`grid size-7 place-items-center rounded-md text-repo-muted hover:bg-repo-btn-hover ${FOCUS}`} onClick={() => setOpen(false)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="px-2 pb-2">
            <CommentForm
              label="Review summary"
              placeholder="Leave a comment"
              autoFocus
              onCancel={() => setOpen(false)}
              onSubmit={({ text }) => {
                if (!canSubmitReview(state, kind, text)) return;
                dispatch({ type: "submit-review", state: kind, body: text, at: Date.now() });
                setOpen(false);
                onSubmitted();
              }}
              actions={({ text }) => (
                <div className="w-full">
                  <fieldset className="mb-3 space-y-2 px-1">
                    <legend className="sr-only">Review kind</legend>
                    {options.map((option) => (
                      <label key={option.value} className={`flex items-start gap-2 text-[14px] ${option.disabled ? "opacity-50" : "cursor-pointer"}`}>
                        <input
                          type="radio"
                          name="review-kind"
                          className="mt-1 accent-repo-accent"
                          checked={kind === option.value}
                          disabled={option.disabled}
                          onChange={() => setKind(option.value)}
                        />
                        <span>
                          <b className="block">{option.title}</b>
                          <span className="text-[12px] text-repo-muted">{option.text}</span>
                        </span>
                      </label>
                    ))}
                    {own && <p className="text-[12px] text-repo-muted">Pull request authors can't approve their own pull request.</p>}
                  </fieldset>
                  <div className="flex items-center justify-end gap-2">
                    {pending > 0 && (
                      <button
                        type="button"
                        className={`${BTN} text-repo-danger`}
                        onClick={() => {
                          dispatch({ type: "discard-review" });
                          setOpen(false);
                        }}
                      >
                        Abandon review
                      </button>
                    )}
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={!canSubmitReview(state, kind, text)}
                      onClick={() => {
                        dispatch({ type: "submit-review", state: kind, body: text, at: Date.now() });
                        setOpen(false);
                        onSubmitted();
                      }}
                    >
                      Submit review
                    </button>
                  </div>
                </div>
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Tree({
  nodes,
  depth,
  collapsed,
  onToggle,
  current,
  onOpen,
  files,
}: {
  nodes: TreeNode[];
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  current: string | null;
  onOpen: (path: string) => void;
  files: Map<string, ChangedFile>;
}) {
  return (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? "File tree" : undefined}>
      {nodes.map((node) => {
        const pad = { paddingLeft: 8 + depth * 16 };
        if (node.kind === "dir") {
          const open = !collapsed.has(node.path);
          return (
            <li key={node.path} role="treeitem" aria-expanded={open} aria-selected={false}>
              <button
                type="button"
                style={pad}
                onClick={() => onToggle(node.path)}
                className={`flex h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[14px] hover:bg-repo-btn-hover ${FOCUS}`}
              >
                <span className="text-repo-muted">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                <span className="text-repo-accent">{open ? <FolderOpen size={16} /> : <Folder size={16} />}</span>
                <span className="min-w-0 truncate">{node.name}</span>
              </button>
              {open && <Tree nodes={node.children} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} current={current} onOpen={onOpen} files={files} />}
            </li>
          );
        }
        const file = files.get(node.path);
        const active = current === node.path;
        return (
          <li key={node.path} role="treeitem" aria-selected={active}>
            <button
              type="button"
              style={{ paddingLeft: 8 + depth * 16 + 20 }}
              onClick={() => onOpen(node.path)}
              className={`relative flex h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[14px] ${FOCUS} ${
                active
                  ? "bg-repo-btn-hover font-semibold after:absolute after:inset-y-1.5 after:left-0 after:w-1 after:rounded-full after:bg-repo-accent"
                  : "hover:bg-repo-btn-hover"
              }`}
            >
              <File size={16} className="flex-none text-repo-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {file && <span className="flex-none">{STATUS_ICON[file.status]}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function FilesTab({
  pr,
  state,
  dispatch,
  now,
  onSubmitted,
}: {
  pr: PullRequest;
  state: PrState;
  dispatch: (action: PrAction) => void;
  now: number;
  onSubmitted: () => void;
}) {
  const [mode, setMode] = useState<DiffMode>(readMode);
  const [draftMode, setDraftMode] = useState<DiffMode>(mode);
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeQuery, setTreeQuery] = useState("");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [hiddenExtensions, setHiddenExtensions] = useState<Set<string>>(new Set());
  const [hideViewed, setHideViewed] = useState(false);
  const sections = useRef(new Map<string, HTMLElement>());

  const byPath = useMemo(() => new Map(pr.files.map((file) => [file.path, file])), [pr.files]);
  const tree = useMemo(() => buildTree(pr.files.map((file) => file.path)), [pr.files]);
  const order = useMemo(() => treeFiles(tree), [tree]);
  const shownTree = useMemo(() => filterTree(tree, treeQuery), [tree, treeQuery]);
  const extensions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const path of order) counts.set(extensionOf(path), (counts.get(extensionOf(path)) ?? 0) + 1);
    return [...counts.entries()];
  }, [order]);
  const shown = order.filter((path) => !hiddenExtensions.has(extensionOf(path)) && !(hideViewed && state.viewed[path]));
  const viewed = viewedCount(state, order);
  const reviewing = pendingCount(state) > 0;
  const open = state.status === "open";

  const applyMode = (value: DiffMode) => {
    setMode(value);
    try {
      localStorage.setItem(MODE_KEY, value);
    } catch {
      /* Not remembered next time */
    }
  };

  const jump = (path: string) => {
    setCurrent(path);
    setCollapsed((all) => ({ ...all, [path]: false }));
    requestAnimationFrame(() => sections.current.get(path)?.scrollIntoView({ block: "start" }));
  };

  const toggleFile = (path: string, event: MouseEvent) => {
    const next = !collapsed[path];
    // Alt+click folds or unfolds every file, as on the site.
    if (event.altKey) setCollapsed(Object.fromEntries(order.map((each) => [each, next])));
    else setCollapsed((all) => ({ ...all, [path]: next }));
  };

  const toolbarButton = `grid size-7 place-items-center rounded-md text-repo-muted hover:bg-repo-btn-hover hover:text-repo-fg ${FOCUS}`;

  return (
    <div>
      <div className={`sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-repo-border bg-repo-canvas px-4 py-3 md:-mx-6 md:px-6`}>
        <button
          type="button"
          className={`${toolbarButton} hidden md:grid`}
          aria-label={treeOpen ? "Hide file tree" : "Show file tree"}
          aria-pressed={treeOpen}
          title={treeOpen ? "Hide file tree" : "Show file tree"}
          onClick={() => setTreeOpen(!treeOpen)}
        >
          {treeOpen ? <PanelLeftClose size={16} aria-hidden="true" /> : <PanelLeftOpen size={16} aria-hidden="true" />}
        </button>
        <span className={`${BTN} hidden h-7 px-2 text-[12px] lg:inline-flex`} aria-hidden="true">
          Changes from all commits
          <ChevronDown size={14} className="text-repo-muted" />
        </span>
        <Dropdown label="File filter" title="File filter">
          {() => (
            <div className="text-[14px]">
              <p className="px-4 pb-1 text-[12px] font-semibold text-repo-muted">File extensions</p>
              {extensions.map(([extension, count]) => (
                <label key={extension} className="flex cursor-pointer items-center gap-2 px-4 py-1.5 hover:bg-repo-btn-hover">
                  <input
                    type="checkbox"
                    className="accent-repo-accent"
                    checked={!hiddenExtensions.has(extension)}
                    onChange={() =>
                      setHiddenExtensions((all) => {
                        const next = new Set(all);
                        if (next.has(extension)) next.delete(extension);
                        else next.add(extension);
                        return next;
                      })
                    }
                  />
                  <span className="flex-1 font-repo-mono text-[12px]">{extension}</span>
                  <span className="text-[12px] text-repo-muted">{count}</span>
                </label>
              ))}
              <div className="my-1 border-t border-repo-border-muted" />
              <label className="flex cursor-pointer items-center gap-2 px-4 py-1.5 hover:bg-repo-btn-hover">
                <input type="checkbox" className="accent-repo-accent" checked={!hideViewed} onChange={() => setHideViewed(!hideViewed)} />
                Viewed files
              </label>
            </div>
          )}
        </Dropdown>
        <span className={`${BTN} hidden h-7 px-2 text-[12px] lg:inline-flex`} aria-hidden="true">
          <MessageSquare size={14} className="text-repo-muted" />
          Conversations
          <ChevronDown size={14} className="text-repo-muted" />
        </span>
        <Dropdown label="Jump to" title="Jump to file">
          {(close) => (
            <ul className="max-h-[320px] overflow-y-auto">
              {order.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className={`block w-full truncate px-4 py-1.5 text-left font-repo-mono text-[12px] hover:bg-repo-btn-hover ${FOCUS}`}
                    onClick={() => {
                      close();
                      jump(path);
                    }}
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dropdown>
        <Dropdown label={<Settings size={14} className="text-repo-muted" aria-label="Diff view settings" />} title="Diff view">
          {(close) => (
            <div className="px-4 text-[14px]">
              <p className="mb-2 font-semibold">Diff view</p>
              {(["unified", "split"] as DiffMode[]).map((value) => (
                <label key={value} className="mb-1.5 flex cursor-pointer items-center gap-2">
                  <input type="radio" name="diff-mode" className="accent-repo-accent" checked={draftMode === value} onChange={() => setDraftMode(value)} />
                  {value === "unified" ? "Unified" : "Split"}
                </label>
              ))}
              <button
                type="button"
                className={`${BTN} mb-2 mt-2 w-full`}
                onClick={() => {
                  applyMode(draftMode);
                  close();
                }}
              >
                Apply and reload
              </button>
            </div>
          )}
        </Dropdown>

        <span className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-2 text-[12px] text-repo-muted sm:flex" aria-live="polite">
            <span className="h-2 w-16 overflow-hidden rounded-full bg-repo-counter" aria-hidden="true">
              <span className="block h-full bg-repo-success-btn" style={{ width: `${order.length ? (viewed / order.length) * 100 : 0}%` }} />
            </span>
            {viewed} / {order.length} files viewed
          </span>
          <ReviewPopover state={state} dispatch={dispatch} author={pr.author} onSubmitted={onSubmitted} />
        </span>
      </div>

      <div className="mt-4 flex items-start gap-4">
        {treeOpen && (
          <aside className="sticky top-[60px] hidden max-h-[calc(100vh-80px)] w-[280px] flex-none self-start overflow-y-auto pb-4 md:block" aria-label="Changed files">
            <label className="relative mb-2 flex items-center">
              <Search size={16} className="pointer-events-none absolute left-2 text-repo-muted" aria-hidden="true" />
              <input
                type="search"
                value={treeQuery}
                onChange={(event) => setTreeQuery(event.target.value)}
                placeholder="Filter changed files"
                aria-label="Filter changed files"
                className={`${INPUT} w-full pl-8`}
              />
            </label>
            {shownTree.length > 0 ? (
              <Tree
                nodes={shownTree}
                depth={0}
                collapsed={folded}
                onToggle={(path) =>
                  setFolded((all) => {
                    const next = new Set(all);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
                current={current}
                onOpen={jump}
                files={byPath}
              />
            ) : (
              <p className="px-2 py-4 text-center text-[12px] text-repo-muted">No files found.</p>
            )}
          </aside>
        )}

        <div className="min-w-0 flex-1 space-y-4">
          {shown.length === 0 && <p className="py-10 text-center text-[14px] text-repo-muted">No files match the filter.</p>}
          {shown.map((path) => {
            const file = byPath.get(path)!;
            const { additions, deletions } = changeCounts(file.hunks);
            const isViewed = !!state.viewed[path];
            const isFolded = !!collapsed[path];
            const threads = threadsByLine(state.threads, path);
            const commentCount = state.threads.filter((thread) => thread.ref.path === path).reduce((sum, thread) => sum + thread.comments.length, 0);
            return (
              <section
                key={path}
                aria-label={path}
                ref={(element) => {
                  if (element) sections.current.set(path, element);
                  else sections.current.delete(path);
                }}
                className="scroll-mt-[60px] rounded-md border border-repo-border"
              >
                <div className={`sticky ${BAR} z-10 flex items-center gap-2 border-b border-repo-border bg-repo-subtle px-2 py-1.5 text-[12px] ${isFolded ? "rounded-md border-b-0" : "rounded-t-md"}`}>
                  <button
                    type="button"
                    className={`grid size-6 flex-none place-items-center rounded-md text-repo-muted hover:bg-repo-btn-hover ${FOCUS}`}
                    aria-label={isFolded ? "Expand file" : "Collapse file"}
                    aria-expanded={!isFolded}
                    title="Alt+click to toggle every file"
                    onClick={(event) => toggleFile(path, event)}
                  >
                    {isFolded ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                  </button>
                  <span className="flex-none text-repo-fg">
                    <span className="mr-1.5 font-repo-mono font-semibold">{(additions + deletions).toLocaleString("en-US")}</span>
                    <Diffstat additions={additions} deletions={deletions} numbers={false} />
                  </span>
                  <span className="min-w-0 truncate font-repo-mono text-[12px] font-semibold" title={path}>
                    {path}
                  </span>
                  <span className="flex-none text-repo-muted" aria-hidden="true">
                    <Copy size={14} />
                  </span>
                  <span className="ml-auto flex flex-none items-center gap-2">
                    {commentCount > 0 && (
                      <span className="hidden items-center gap-1 text-repo-muted sm:flex" title={`${commentCount} comments`}>
                        <MessageSquare size={14} aria-hidden="true" />
                        {commentCount}
                      </span>
                    )}
                    <label
                      className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[12px] ${
                        isViewed ? "border-repo-accent bg-repo-accent-soft" : "border-repo-border bg-repo-btn hover:bg-repo-btn-hover"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-repo-accent"
                        checked={isViewed}
                        onChange={() => {
                          dispatch({ type: "viewed", path, viewed: !isViewed });
                          setCollapsed((all) => ({ ...all, [path]: !isViewed }));
                        }}
                      />
                      Viewed
                    </label>
                    <span className="grid size-7 place-items-center text-repo-muted" aria-hidden="true">
                      <Ellipsis size={16} />
                    </span>
                  </span>
                </div>
                {!isFolded && (
                  <DiffView file={file} mode={mode} threads={threads} reviewing={reviewing} now={now} dispatch={dispatch} interactive={open} />
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

