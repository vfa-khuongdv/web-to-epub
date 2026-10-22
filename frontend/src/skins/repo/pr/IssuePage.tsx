// An issue page: title and number, Open / Closed badge and "opened this issue · N
// comments", the timeline, and the comment box with "Close issue" (as completed or as not
// planned) or "Reopen issue" — beside the sidebar. In memory only, like the pull requests.

import { ChevronDown, CircleCheck, CircleDot, CircleSlash } from "lucide-react";
import { ReactNode, useEffect, useReducer, useRef, useState } from "react";
import { Avatar, BTN, BTN_PRIMARY, FOCUS } from "../RepoChrome";
import { CommentForm } from "./CommentForm";
import { Sidebar } from "./Sidebar";
import { IssueState, commentCount, initialIssueState, issueReducer } from "./state";
import { TIMELINE, Timeline, TimelineComment } from "./Timeline";
import { Issue, ME } from "./types";
import { Markdown, POPOVER, StateBadge, TimeAgo, escapeCloses, useOutsideClick } from "./ui";

type Reason = "completed" | "not_planned";

function CloseButton({ text, onClose }: { text: string; onClose: (reason: Reason) => void }) {
  const [reason, setReason] = useState<Reason>("completed");
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useOutsideClick(box, menu, () => setMenu(false));
  const label = text.trim() ? "Close with comment" : "Close issue";
  return (
    <div ref={box} className="relative inline-flex" onKeyDown={menu ? escapeCloses(() => setMenu(false), toggle) : undefined}>
      <button type="button" className={`${BTN} rounded-r-none`} onClick={() => onClose(reason)}>
        {reason === "completed" ? <CircleCheck size={16} className="text-repo-done" aria-hidden="true" /> : <CircleSlash size={16} className="text-repo-muted" aria-hidden="true" />}
        {label}
      </button>
      <button
        ref={toggle}
        type="button"
        aria-label="More close options"
        aria-expanded={menu}
        aria-haspopup="menu"
        className={`${BTN} rounded-l-none border-l-0 px-2`}
        onClick={() => setMenu(!menu)}
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {menu && (
        <ul role="menu" aria-label="Close options" className={`${POPOVER} bottom-10 right-0 w-[300px] py-1`}>
          {(
            [
              ["completed", "Close as completed", "Done, closed, fixed, resolved", <CircleCheck key="c" size={16} className="text-repo-done" />],
              ["not_planned", "Close as not planned", "Won't fix, can't repro, duplicate, stale", <CircleSlash key="n" size={16} className="text-repo-muted" />],
            ] as [Reason, string, string, ReactNode][]
          ).map(([value, title, hint, icon]) => (
            <li key={value} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={reason === value}
                className={`flex w-full gap-2 px-3 py-2 text-left hover:bg-repo-btn-hover ${FOCUS}`}
                onClick={() => {
                  setReason(value);
                  setMenu(false);
                }}
              >
                <span className="pt-0.5">{icon}</span>
                <span>
                  <b className="block text-[14px]">{title}</b>
                  <span className="text-[12px] text-repo-muted">{hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IssuePage({
  issue,
  now,
  saved,
  onSave,
  development,
}: {
  issue: Issue;
  now: number;
  saved?: IssueState;
  onSave?: (state: IssueState) => void;
  development?: ReactNode;
}) {
  const [state, dispatch] = useReducer(issueReducer, issue, (initial) => saved ?? initialIssueState(initial));
  const save = useRef(onSave);
  save.current = onSave;
  useEffect(() => {
    save.current?.(state);
  }, [state]);

  const comments = commentCount(state.timeline);
  const participants = [...new Set([issue.author, ...state.timeline.map((item) => item.author)])];
  const badge = state.status === "open" ? "open" : state.reason === "not_planned" ? "not_planned" : "completed";

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-10 pt-6 md:px-6">
      <div className="mb-2 flex flex-wrap items-start gap-2 md:flex-nowrap">
        <h1 className="min-w-0 flex-1 break-words text-[26px] font-normal leading-[1.25] md:text-[32px]">
          <bdi>{issue.title}</bdi> <span className="font-light text-repo-muted">#{issue.number}</span>
        </h1>
        <span className="flex flex-none gap-2 md:pt-1" aria-hidden="true">
          <span className={`${BTN} h-7 px-3 text-[12px]`}>Edit</span>
          <span className={`${BTN_PRIMARY} h-7 px-3 text-[12px]`}>New issue</span>
        </span>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-repo-border pb-4 text-[14px] text-repo-muted">
        <StateBadge state={badge} kind="issue" />
        <span>
          <b className="text-repo-fg">{issue.author}</b> opened this issue <TimeAgo at={issue.at} now={now} /> · {comments} {comments === 1 ? "comment" : "comments"}
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_256px] lg:gap-8">
        <div className="min-w-0">
          <div className={TIMELINE}>
            <TimelineComment author={issue.author} at={issue.at} now={now} role="Author" action="opened">
              <Markdown source={issue.body} />
            </TimelineComment>
            <Timeline items={state.timeline} kind="issue" author={issue.author} now={now} />
          </div>
          <div className="relative mt-6 border-t-2 border-repo-border pt-6 sm:pl-14">
            <span className="absolute left-0 top-6 hidden sm:block">
              <Avatar seed={ME} size={40} />
            </span>
            <h2 className="mb-2 text-[16px] font-semibold">Add a comment</h2>
            <CommentForm
              label="Add a comment"
              placeholder="Use Markdown to format your comment"
              onSubmit={({ text, reset }) => {
                dispatch({ type: "comment", body: text, at: Date.now() });
                reset();
              }}
              actions={({ text, reset }) => (
                <>
                  {state.status === "open" ? (
                    <CloseButton
                      text={text}
                      onClose={(reason) => {
                        dispatch({ type: "comment", body: text, at: Date.now(), close: reason });
                        reset();
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={BTN}
                      onClick={() => {
                        if (text.trim()) dispatch({ type: "comment", body: text, at: Date.now() });
                        dispatch({ type: "reopen", at: Date.now() });
                        reset();
                      }}
                    >
                      <CircleDot size={16} className="text-repo-success" aria-hidden="true" />
                      {text.trim() ? "Reopen with comment" : "Reopen issue"}
                    </button>
                  )}
                  <button
                    type="button"
                    className={BTN_PRIMARY}
                    disabled={!text.trim()}
                    onClick={() => {
                      dispatch({ type: "comment", body: text, at: Date.now() });
                      reset();
                    }}
                  >
                    Comment
                  </button>
                </>
              )}
            />
          </div>
        </div>
        <Sidebar
          kind="issue"
          reviewers={null}
          assignees={issue.assignees}
          labels={issue.labels}
          project={issue.project}
          milestone={issue.milestone}
          development={development ?? <p>No branches or pull requests</p>}
          participants={participants}
          subscribed={state.subscribed}
          onSubscribe={(subscribed) => dispatch({ type: "subscribe", subscribed })}
        />
      </div>
    </div>
  );
}
