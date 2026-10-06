// A review conversation on one line of a diff: its comments (pending ones marked), the
// "Reply..." box and "Resolve conversation". Drawn inside the diff on Files changed and,
// with the lines it quotes, in the Conversation timeline. Also the form that starts a new
// one from a line's "+" button.

import { ChevronDown, ChevronRight, Ellipsis, Smile } from "lucide-react";
import { useState } from "react";
import { Avatar, BTN, BTN_PRIMARY, FOCUS, Label } from "../RepoChrome";
import { CommentForm } from "./CommentForm";
import { DiffLine } from "./diff";
import { CodeText } from "./Highlighted";
import { Language } from "./highlight";
import { PrAction } from "./state";
import { LineRef, ReviewThread } from "./types";
import { TimeAgo } from "./ui";

// The buttons under a comment written on a diff: on its own, or as part of a review.
function reviewButtons(reviewing: boolean, submit: (review: boolean) => void, cancel: () => void, empty: boolean) {
  return (
    <>
      <button type="button" className={BTN} onClick={cancel}>
        Cancel
      </button>
      {reviewing ? (
        <button type="button" className={BTN_PRIMARY} disabled={empty} onClick={() => submit(true)}>
          Add review comment
        </button>
      ) : (
        <>
          <button type="button" className={BTN} disabled={empty} onClick={() => submit(false)}>
            Add single comment
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={empty} onClick={() => submit(true)}>
            Start a review
          </button>
        </>
      )}
    </>
  );
}

export function NewLineComment({
  target: line,
  reviewing,
  dispatch,
  onClose,
}: {
  target: LineRef;
  reviewing: boolean;
  dispatch: (action: PrAction) => void;
  onClose: () => void;
}) {
  return (
    <div className="max-w-[880px] p-2 font-repo">
      <CommentForm
        label={`Comment on line ${line.side}${line.line}`}
        placeholder="Leave a comment"
        autoFocus
        onCancel={onClose}
        onSubmit={({ text }) => {
          dispatch({ type: "line-comment", ref: line, body: text, at: Date.now(), review: reviewing });
          onClose();
        }}
        actions={({ text }) =>
          reviewButtons(
            reviewing,
            (review) => {
              dispatch({ type: "line-comment", ref: line, body: text, at: Date.now(), review });
              onClose();
            },
            onClose,
            !text.trim()
          )
        }
      />
    </div>
  );
}

export function ThreadView({
  thread,
  reviewing,
  now,
  dispatch,
  quote,
  canResolve = true,
}: {
  thread: ReviewThread;
  reviewing: boolean;
  now: number;
  dispatch: (action: PrAction) => void;
  // In the conversation: the file and the lines the comment was written on.
  quote?: { path: string; lines: DiffLine[]; language: Language };
  canResolve?: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const [expanded, setExpanded] = useState(!thread.resolved);
  const open = expanded || !thread.resolved;

  return (
    <div className="overflow-hidden rounded-md border border-repo-border bg-repo-canvas font-repo text-[14px]">
      {quote && (
        <div className="flex items-center gap-2 border-b border-repo-border bg-repo-subtle px-3 py-2 text-[12px]">
          <button
            type="button"
            className={`grid size-5 place-items-center rounded text-repo-muted hover:text-repo-fg ${FOCUS}`}
            aria-label={open ? "Hide conversation" : "Show conversation"}
            aria-expanded={open}
            onClick={() => setExpanded(!open)}
          >
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <span className="min-w-0 flex-1 truncate font-repo-mono text-repo-accent">{quote.path}</span>
          {thread.resolved && <Label>Resolved</Label>}
        </div>
      )}
      {!quote && thread.resolved && (
        <div className="flex items-center gap-2 border-b border-repo-border bg-repo-subtle px-3 py-2 text-[12px] text-repo-muted">
          <span className="flex-1">This conversation was marked as resolved.</span>
          <button type="button" className={`${BTN} h-7 text-[12px]`} onClick={() => setExpanded(!open)}>
            {open ? "Hide resolved" : "Show resolved"}
          </button>
        </div>
      )}
      {open && (
        <>
          {quote && quote.lines.length > 0 && (
            <table className="w-full border-collapse border-b border-repo-border font-repo-mono text-[12px] leading-[20px]">
              <tbody>
                {quote.lines.map((line, index) => (
                  <tr key={index} className={line.kind === "add" ? "bg-repo-diff-add" : line.kind === "del" ? "bg-repo-diff-del" : ""}>
                    <td className="w-[1%] min-w-[40px] select-none px-2 text-right text-repo-muted">{line.old ?? ""}</td>
                    <td className="w-[1%] min-w-[40px] select-none px-2 text-right text-repo-muted">{line.new ?? ""}</td>
                    <td className="whitespace-pre-wrap [overflow-wrap:anywhere] pr-3">
                      <span className="select-none">{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}</span>
                      <CodeText text={line.text} language={quote.language} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ul>
            {thread.comments.map((comment) => (
              <li key={comment.id} className="border-t border-repo-border-muted px-4 py-3 first:border-t-0">
                <div className="mb-1 flex items-center gap-2 text-[14px]">
                  <Avatar seed={comment.author} size={24} />
                  <b>{comment.author}</b>
                  <span className="text-repo-muted">
                    <TimeAgo at={comment.at} now={now} />
                  </span>
                  {comment.pending && (
                    <span className="rounded-full border border-repo-attention-rule bg-repo-attention-soft px-2 text-[12px] font-medium leading-[18px] text-repo-attention">
                      Pending
                    </span>
                  )}
                  <span className="ml-auto text-repo-muted" aria-hidden="true">
                    <Ellipsis size={16} />
                  </span>
                </div>
                <div className="pl-8 text-[14px] leading-[1.5]">
                  <p className="whitespace-pre-wrap break-words">{comment.body}</p>
                  <span className="mt-2 inline-grid size-7 place-items-center rounded-full border border-repo-border text-repo-muted" aria-hidden="true">
                    <Smile size={14} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-repo-border bg-repo-subtle px-4 py-2">
            {replying ? (
              <div className="py-1">
                <CommentForm
                  label="Reply"
                  placeholder="Reply..."
                  autoFocus
                  minHeight={72}
                  onCancel={() => setReplying(false)}
                  onSubmit={({ text }) => {
                    dispatch({ type: "reply", threadId: thread.id, body: text, at: Date.now(), review: reviewing });
                    setReplying(false);
                  }}
                  actions={({ text }) =>
                    reviewButtons(
                      reviewing,
                      (review) => {
                        dispatch({ type: "reply", threadId: thread.id, body: text, at: Date.now(), review });
                        setReplying(false);
                      },
                      () => setReplying(false),
                      !text.trim()
                    )
                  }
                />
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Avatar seed="dev" size={24} />
                <button
                  type="button"
                  onClick={() => setReplying(true)}
                  className={`h-8 min-w-[160px] flex-1 rounded-md border border-repo-border bg-repo-input px-3 text-left text-[14px] text-repo-muted hover:border-repo-muted ${FOCUS}`}
                >
                  Reply...
                </button>
                {canResolve && (
                  <button type="button" className={BTN} onClick={() => dispatch({ type: "resolve", threadId: thread.id, resolved: !thread.resolved })}>
                    {thread.resolved ? "Unresolve conversation" : "Resolve conversation"}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
