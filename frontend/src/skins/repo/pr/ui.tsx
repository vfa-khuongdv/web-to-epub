// Small pieces the pull request and issue pages share: state badges, label chips, branch
// names, the diffstat, relative times, comment Markdown, and a popover that closes on a
// click outside or Escape. Keys are handled on the elements themselves, never on the
// document: inside the boss key's decoy, keys stop at the decoy's frame.

import { Check, CircleCheck, CircleDot, CircleSlash, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import { KeyboardEvent, ReactNode, RefObject, useEffect, useRef } from "react";
import { relativeTime } from "../repoModel";
import { Block, diffstatBlocks } from "./diff";
import { Inline, MdBlock, parseMarkdown } from "./markdown";
import { IssueLabel, LabelTone } from "./types";

const LABEL_TONES: Record<LabelTone, string> = {
  red: "bg-repo-label-red text-repo-label-red-fg border-repo-label-red-rule",
  orange: "bg-repo-label-orange text-repo-label-orange-fg border-repo-label-orange-rule",
  yellow: "bg-repo-label-yellow text-repo-label-yellow-fg border-repo-label-yellow-rule",
  green: "bg-repo-label-green text-repo-label-green-fg border-repo-label-green-rule",
  blue: "bg-repo-label-blue text-repo-label-blue-fg border-repo-label-blue-rule",
  cyan: "bg-repo-label-cyan text-repo-label-cyan-fg border-repo-label-cyan-rule",
  purple: "bg-repo-label-purple text-repo-label-purple-fg border-repo-label-purple-rule",
  gray: "bg-repo-label-gray text-repo-label-gray-fg border-repo-label-gray-rule",
};

export function LabelChip({ label }: { label: IssueLabel }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-[7px] text-[12px] font-medium leading-[18px] ${LABEL_TONES[label.tone]}`}>
      {label.name}
    </span>
  );
}

export type BadgeState = "open" | "merged" | "closed" | "draft" | "completed" | "not_planned";

// The pill under a title: Open (green), Merged (purple), Closed (red), Draft (grey); a
// closed issue is purple when done and grey when not planned, as on the site.
export function StateBadge({ state, kind, small = false }: { state: BadgeState; kind: "pr" | "issue"; small?: boolean }) {
  const tones: Record<BadgeState, string> = {
    open: "bg-repo-success-btn",
    merged: "bg-repo-done-emphasis",
    closed: "bg-repo-danger-emphasis",
    draft: "bg-repo-neutral-emphasis",
    completed: "bg-repo-done-emphasis",
    not_planned: "bg-repo-neutral-emphasis",
  };
  const size = small ? 14 : 16;
  const icons: Record<BadgeState, ReactNode> = {
    open: kind === "pr" ? <GitPullRequest size={size} /> : <CircleDot size={size} />,
    merged: <GitMerge size={size} />,
    closed: <GitPullRequestClosed size={size} />,
    draft: <GitPullRequestDraft size={size} />,
    completed: <CircleCheck size={size} />,
    not_planned: <CircleSlash size={size} />,
  };
  const words: Record<BadgeState, string> = {
    open: "Open",
    merged: "Merged",
    closed: "Closed",
    draft: "Draft",
    completed: "Closed",
    not_planned: "Closed",
  };
  return (
    <span
      className={`inline-flex flex-none items-center gap-1 rounded-full font-medium capitalize text-white ${tones[state]} ${
        small ? "px-2 py-0.5 text-[12px]" : "px-3 py-[5px] text-[14px] leading-5"
      }`}
    >
      <span aria-hidden="true">{icons[state]}</span>
      {words[state]}
    </span>
  );
}

// A branch name the way the site sets it: monospace on a pale blue chip.
export function BranchName({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block max-w-full truncate rounded-md bg-repo-accent-soft px-1.5 align-middle font-repo-mono text-[12px] leading-[20px] text-repo-accent">
      {children}
    </span>
  );
}

const BLOCK_TONE: Record<Block, string> = { add: "bg-repo-success", del: "bg-repo-danger", neutral: "bg-repo-counter" };

export function Diffstat({ additions, deletions, numbers = true }: { additions: number; deletions: number; numbers?: boolean }) {
  return (
    <span className="inline-flex flex-none items-center gap-1.5 font-repo-mono text-[12px] font-semibold">
      {numbers && (
        <>
          <span className="text-repo-success">+{additions.toLocaleString("en-US")}</span>
          <span className="text-repo-danger">−{deletions.toLocaleString("en-US")}</span>
        </>
      )}
      <span className="inline-flex gap-px" aria-hidden="true">
        {diffstatBlocks(additions, deletions).map((block, index) => (
          <span key={index} className={`inline-block size-2 rounded-[1px] ${BLOCK_TONE[block]}`} />
        ))}
      </span>
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fullDate(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}, ${time}`;
}

export function ago(at: number, now: number): string {
  return relativeTime(new Date(at).toISOString(), now);
}

export function TimeAgo({ at, now }: { at: number; now: number }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={fullDate(at)} className="whitespace-nowrap">
      {ago(at, now)}
    </time>
  );
}

// ---- Markdown ----------------------------------------------------------------------------

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        switch (part.kind) {
          case "code":
            return (
              <code key={index} className="rounded-md bg-repo-counter px-[0.4em] py-[0.2em] font-repo-mono text-[85%]">
                {part.text}
              </code>
            );
          case "bold":
            return <strong key={index}>{part.text}</strong>;
          case "italic":
            return <em key={index}>{part.text}</em>;
          case "ref":
          case "link":
            return (
              <span key={index} className="text-repo-accent">
                {part.text}
              </span>
            );
          case "mention":
            return (
              <span key={index} className="font-semibold">
                {part.text}
              </span>
            );
          default:
            return <span key={index}>{part.text}</span>;
        }
      })}
    </>
  );
}

const HEADING_SIZE = ["", "text-[2em] border-b pb-[0.3em]", "text-[1.5em] border-b pb-[0.3em]", "text-[1.25em]", "text-[1em]", "text-[0.875em]", "text-[0.85em] text-repo-muted"];

function Blocks({ blocks }: { blocks: MdBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const Tag = `h${Math.min(6, block.level)}` as "h2";
            return (
              <Tag key={index} className={`mb-4 mt-6 border-repo-border-muted font-semibold leading-[1.25] first:mt-0 ${HEADING_SIZE[block.level]}`}>
                <InlineText parts={block.inline} />
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={index} className="mb-4 last:mb-0">
                {block.lines.map((line, at) => (
                  <span key={at}>
                    {at > 0 && <br />}
                    <InlineText parts={line} />
                  </span>
                ))}
              </p>
            );
          case "list": {
            const tasks = block.items.some((item) => item.task !== null);
            const List = block.ordered ? "ol" : "ul";
            return (
              <List key={index} className={`mb-4 last:mb-0 ${tasks ? "list-none pl-0" : block.ordered ? "list-decimal pl-8" : "list-disc pl-8"}`}>
                {block.items.map((item, at) => (
                  <li key={at} className={`mt-1 first:mt-0 ${item.task !== null ? "flex items-start gap-2" : ""}`}>
                    {item.task !== null && (
                      <span
                        aria-hidden="true"
                        className={`mt-[3px] grid size-[14px] flex-none place-items-center rounded-[3px] border ${
                          item.task ? "border-repo-accent bg-repo-accent text-white" : "border-repo-muted bg-repo-canvas"
                        }`}
                      >
                        {item.task && <Check size={10} strokeWidth={3.5} />}
                      </span>
                    )}
                    <span className="min-w-0">
                      <InlineText parts={item.inline} />
                    </span>
                  </li>
                ))}
              </List>
            );
          }
          case "code":
            return (
              <pre key={index} className="mb-4 overflow-x-auto rounded-md bg-repo-subtle p-4 font-repo-mono text-[85%] leading-[1.45] last:mb-0">
                {block.lines.join("\n")}
              </pre>
            );
          case "quote":
            return (
              <blockquote key={index} className="mb-4 border-l-[0.25em] border-repo-border px-4 text-repo-muted last:mb-0">
                <Blocks blocks={block.blocks} />
              </blockquote>
            );
          default:
            return <hr key={index} className="my-6 h-1 border-0 bg-repo-border-muted" />;
        }
      })}
    </>
  );
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="break-words text-[14px] leading-[1.5]">
      <Blocks blocks={parseMarkdown(source)} />
    </div>
  );
}

// ---- Popovers ----------------------------------------------------------------------------

/**
 * Closes an open popover on a click outside `ref`. Escape is the caller's, through
 * `escapeCloses` on the popover's own element: inside the decoy, keys never reach the
 * document.
 */
export function useOutsideClick(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) close.current();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [open, ref]);
}

export function escapeCloses(onClose: () => void, restore?: RefObject<HTMLElement | null>) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
    restore?.current?.focus();
  };
}

export const POPOVER = "absolute z-30 rounded-xl border border-repo-border bg-repo-overlay text-[14px] text-repo-fg shadow-[0_8px_24px_var(--color-repo-shadow)]";
