// One file's diff, unified or split: line numbers, the green and red rows, hunk headers,
// syntax colours, the review threads under their lines, and the blue "+" that appears on
// a hovered line to start a comment there.

import { Plus } from "lucide-react";
import { Fragment, ReactNode, useState } from "react";
import { DiffLine, lineKey, lineSide, splitRows, unifiedRows } from "./diff";
import { CodeText } from "./Highlighted";
import { Language, languageOf } from "./highlight";
import { PrAction } from "./state";
import { NewLineComment, ThreadView } from "./Thread";
import { ChangedFile, LineRef, ReviewThread } from "./types";

export type DiffMode = "unified" | "split";

const ROW_BG = { add: "bg-repo-diff-add", del: "bg-repo-diff-del", context: "" };
const NUM_BG = { add: "bg-repo-diff-add-num", del: "bg-repo-diff-del-num", context: "" };
const SIGN = { add: "+", del: "-", context: " " };

const NUM = "w-[1%] min-w-[50px] cursor-pointer select-none whitespace-nowrap px-2.5 text-right align-top text-repo-muted hover:text-repo-fg";

function AddButton({ line, onClick }: { line: LineRef; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Add a comment on line ${line.side}${line.line}`}
      title="Add a comment on this line"
      onClick={onClick}
      className="absolute left-[-10px] top-0 z-[1] grid size-5 place-items-center rounded-md bg-repo-accent text-white opacity-0 shadow transition-transform hover:scale-110 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-repo-focus group-hover:opacity-100"
    >
      <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}

// The code of one line. In the split view each half is its own hover target (`ownHover`),
// so the "+" shows on the side under the pointer.
function CodeCell({
  line,
  language,
  target,
  onAdd,
  selected,
  ownHover = false,
}: {
  line: DiffLine | null;
  language: Language;
  target: LineRef | null;
  onAdd: (target: LineRef) => void;
  selected: boolean;
  ownHover?: boolean;
}) {
  if (!line) return <td className="bg-repo-subtle" />;
  return (
    <td className={`${ownHover ? "group" : ""} relative whitespace-pre-wrap [overflow-wrap:anywhere] py-0 pl-[22px] pr-2.5 align-top ${selected ? "bg-repo-attention-soft" : ROW_BG[line.kind]}`}>
      {target && <AddButton line={target} onClick={() => onAdd(target)} />}
      <span className="absolute left-2.5 select-none" aria-hidden="true">
        {SIGN[line.kind]}
      </span>
      <CodeText text={line.text} language={language} />
    </td>
  );
}

export function DiffView({
  file,
  mode,
  threads,
  reviewing,
  now,
  dispatch,
  interactive = true,
}: {
  file: ChangedFile;
  mode: DiffMode;
  threads: Map<string, ReviewThread[]>;
  reviewing: boolean;
  now: number;
  dispatch: (action: PrAction) => void;
  // A pull request that is closed or merged takes no new comments.
  interactive?: boolean;
}) {
  const language = languageOf(file.path);
  const [composing, setComposing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const add = (target: LineRef) => setComposing(lineKey(target.side, target.line));

  const extras = (key: string, target: LineRef | null): ReactNode => {
    const list = threads.get(key) ?? [];
    const open = composing === key && target;
    if (list.length === 0 && !open) return null;
    return (
      <div className="space-y-2 border-y border-repo-border bg-repo-subtle/50 px-2 py-2 font-repo">
        {list.map((thread) => (
          <div key={thread.id} className="max-w-[880px]">
            <ThreadView thread={thread} reviewing={reviewing} now={now} dispatch={dispatch} />
          </div>
        ))}
        {open && <NewLineComment target={target} reviewing={reviewing} dispatch={dispatch} onClose={() => setComposing(null)} />}
      </div>
    );
  };

  const number = (value: number | null, kind: DiffLine["kind"] | null, key: string | null) => (
    <td
      className={`${NUM} ${kind ? (key && selected === key ? "bg-repo-attention-soft" : NUM_BG[kind]) : "bg-repo-subtle"}`}
      onClick={key ? () => setSelected(selected === key ? null : key) : undefined}
    >
      {value ?? ""}
    </td>
  );

  const hunkRow = (header: string, index: number, span: number) => (
    <tr key={`hunk-${index}`} className="bg-repo-diff-hunk text-repo-muted">
      <td colSpan={mode === "split" ? 1 : 2} className="bg-repo-diff-hunk-num px-2.5" aria-hidden="true" />
      <td colSpan={span} className="whitespace-pre-wrap [overflow-wrap:anywhere] px-2.5 py-1">
        {header}
      </td>
    </tr>
  );

  let body: ReactNode;
  if (mode === "unified") {
    body = unifiedRows(file.hunks).map((row) => {
      if (row.kind === "hunk") return hunkRow(row.header, row.index, 1);
      const { line } = row;
      const target = interactive ? { path: file.path, ...lineSide(line) } : null;
      const key = lineKey(lineSide(line).side, lineSide(line).line);
      const rowKey = `${line.old ?? "-"}:${line.new ?? "-"}`;
      const more = extras(key, target);
      return (
        <Fragment key={rowKey}>
          <tr className="group" data-line={key}>
            {number(line.old, line.kind, key)}
            {number(line.new, line.kind, key)}
            <CodeCell line={line} language={language} target={target} onAdd={add} selected={selected === key} />
          </tr>
          {more && (
            <tr>
              <td colSpan={3} className="p-0">
                {more}
              </td>
            </tr>
          )}
        </Fragment>
      );
    });
  } else {
    body = splitRows(file.hunks).map((row, index) => {
      if (row.kind === "hunk") return hunkRow(row.header, row.index, 3);
      const { left, right } = row;
      const context = left?.kind === "context";
      // A kept line's comments hang on the new side, whichever half the "+" was in.
      const leftTarget = left && interactive ? (context ? { path: file.path, side: "R" as const, line: left.new ?? 0 } : { path: file.path, ...lineSide(left) }) : null;
      const rightTarget = right && interactive ? { path: file.path, ...lineSide(right) } : null;
      const leftKey = left && !context ? lineKey("L", left.old ?? 0) : null;
      const rightKey = right ? lineKey("R", right.new ?? 0) : null;
      const leftMore = leftKey ? extras(leftKey, leftTarget) : null;
      const rightMore = rightKey ? extras(rightKey, context ? leftTarget : rightTarget) : null;
      return (
        <Fragment key={`pair-${index}`}>
          <tr data-line={rightKey ?? leftKey ?? undefined}>
            {number(left?.old ?? null, left?.kind ?? null, leftKey ?? rightKey)}
            <CodeCell line={left} language={language} target={leftTarget} onAdd={add} selected={!!leftKey && selected === leftKey} ownHover />
            {number(right?.new ?? null, right?.kind ?? null, rightKey)}
            <CodeCell line={right} language={language} target={rightTarget} onAdd={add} selected={!!rightKey && selected === rightKey} ownHover />
          </tr>
          {(leftMore || rightMore) && (
            <tr>
              <td colSpan={2} className="p-0 align-top">
                {leftMore}
              </td>
              <td colSpan={2} className="border-l border-repo-border p-0 align-top">
                {rightMore}
              </td>
            </tr>
          )}
        </Fragment>
      );
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse font-repo-mono text-[12px] leading-[20px] ${mode === "split" ? "table-fixed" : ""}`}>
        {mode === "split" && (
          <colgroup>
            <col className="w-[50px]" />
            <col />
            <col className="w-[50px]" />
            <col />
          </colgroup>
        )}
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
