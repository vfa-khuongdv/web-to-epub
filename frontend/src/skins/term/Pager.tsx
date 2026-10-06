import { KeyboardEvent, PointerEvent, WheelEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../../i18n";
import { PagerView, clampTop, colonKey, pagerKey, pagerStatus, wheelRows } from "./pagerKeys";
import { FileRow, findRow, lineAtRow, matchRanges, rowOfLine } from "./text";

// The pager's key summary (h), drawn as its own little file. Program chrome: literal.
const HELP: string[] = [
  "",
  "                 KEYS",
  "",
  "  SPACE  f  PgDn  ^F      Forward one screen",
  "  b  PgUp  ^B             Backward one screen",
  "  j  ↓  RETURN            Forward one line",
  "  k  ↑                    Backward one line",
  "  d  /  u                 Forward / backward half a screen",
  "  g  <  Home              First line",
  "  G  >  End               Last line",
  "",
  "  /pattern                Search forward",
  "  ?pattern                Search backward",
  "  n  /  N                 Next / previous match",
  "",
  "  :n  ]                   Next file",
  "  :p  [                   Previous file",
  "",
  "  q                       Quit",
  "",
];
const HELP_ROWS: FileRow[] = HELP.map((text, index) => ({ text, line: index, kind: text ? "text" : "blank" }));

const LINK =
  "rounded-[3px] px-1 text-term-dim outline-none hover:bg-term-hover hover:text-term-fg focus-visible:outline-1 focus-visible:outline-term-blue";

// A row with the search matches marked.
function Row({ row, pattern }: { row: FileRow; pattern: string }) {
  const ranges = pattern ? matchRanges(row.text, pattern) : [];
  const tone = row.kind === "heading" ? "font-bold" : row.kind === "media" ? "text-term-dim" : "";
  if (ranges.length === 0) return <div className={`h-[1lh] whitespace-pre ${tone}`}>{row.text}</div>;
  const parts = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(<span key={`t${at}`}>{row.text.slice(at, start)}</span>);
    parts.push(
      <mark key={`m${start}`} className="bg-term-match text-term-match-fg">
        {row.text.slice(start, end)}
      </mark>
    );
    at = end;
  }
  if (at < row.text.length) parts.push(<span key={`t${at}`}>{row.text.slice(at)}</span>);
  return <div className={`h-[1lh] whitespace-pre ${tone}`}>{parts}</div>;
}

type Mode = { kind: "normal" } | { kind: "search"; direction: 1 | -1; text: string } | { kind: "colon" };

/**
 * `less` on a file: the text a screen at a time, the prompt line in reverse video at the
 * bottom. Keyboard first (see pager.ts), the wheel and a touch drag scroll, a tap on the
 * lower or upper part of the screen turns a page. The pager is not a text field, so the
 * boss key works from it as from anywhere; the search pattern is typed into the prompt
 * line the way less reads it. The row at the top is reported as a chapter line, which is
 * what the reading position remembers.
 */
export function Pager({
  name,
  rows,
  error,
  initialLine,
  fileIndex,
  notice,
  screenRows,
  lineHeight,
  focusToken,
  onTopLine,
  onQuit,
  onFile,
}: {
  name: string;
  // null while the file loads.
  rows: FileRow[] | null;
  error: string | null;
  initialLine: number;
  fileIndex: { at: number; of: number } | null;
  // A message from the shell (a failed download, nothing after this file).
  notice: { id: number; text: string } | null;
  screenRows: number;
  lineHeight: number;
  focusToken: number;
  onTopLine: (line: number) => void;
  onQuit: () => void;
  onFile: (direction: 1 | -1) => void;
}) {
  const { t } = useLang();
  const root = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "normal" });
  const [pattern, setPattern] = useState("");
  const [lastDirection, setLastDirection] = useState<1 | -1>(1);
  const [message, setMessage] = useState<string | null>(null);
  const [help, setHelp] = useState<{ top: number } | null>(null);
  const [showIndex, setShowIndex] = useState(!!fileIndex);
  // The chapter line at the top: kept across a re-wrap (resize, zoom) or a re-read.
  const anchor = useRef(initialLine);
  const placed = useRef(false);
  const wheelCarry = useRef(0);
  const drag = useRef<{ y: number; top: number; moved: boolean } | null>(null);

  const height = Math.max(1, screenRows - 1);
  const shownRows = help ? HELP_ROWS : (rows ?? []);
  const shownTop = help ? help.top : top;
  const view: PagerView = { top: shownTop, height, total: shownRows.length };

  // The file's rows changed (first load, new width, new text): back to the same line.
  useLayoutEffect(() => {
    if (!rows) return;
    setTop(clampTop(rowOfLine(rows, anchor.current), { height, total: rows.length }));
    placed.current = true;
  }, [rows, height]);

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, [focusToken]);

  useEffect(() => {
    if (notice) setMessage(notice.text);
  }, [notice]);

  const moveTo = (next: number) => {
    if (help) {
      setHelp({ top: clampTop(next, { height, total: HELP_ROWS.length }) });
      return;
    }
    if (!rows) return;
    const clamped = clampTop(next, { height, total: rows.length });
    setTop(clamped);
    const line = lineAtRow(rows, clamped);
    anchor.current = line;
    if (placed.current) onTopLine(line);
  };

  const search = (text: string, direction: 1 | -1, from: number) => {
    if (!rows || !text) return;
    const found = findRow(rows, text, from, direction);
    if (found < 0) setMessage("Pattern not found");
    else moveTo(found);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || (event.altKey && !event.ctrlKey)) return;
    if (event.key === "F1" || (event.ctrlKey && event.shiftKey)) return;
    if (mode.kind === "search") {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape" || (event.key === "Backspace" && !mode.text)) setMode({ kind: "normal" });
      else if (event.key === "Backspace") setMode({ ...mode, text: mode.text.slice(0, -1) });
      else if (event.key === "Enter") {
        setMode({ kind: "normal" });
        const text = mode.text || pattern;
        setPattern(text);
        setLastDirection(mode.direction);
        // A new search starts at the line on top, as less's does.
        search(text, mode.direction, mode.direction === 1 ? top - 1 : top);
      } else if (event.key.length === 1 && !event.ctrlKey) setMode({ ...mode, text: mode.text + event.key });
      return;
    }
    if (mode.kind === "colon") {
      event.preventDefault();
      event.stopPropagation();
      setMode({ kind: "normal" });
      const action = colonKey(event.key);
      if (action.type === "file") onFile(action.direction);
      else if (action.type === "quit") onQuit();
      return;
    }
    const action = pagerKey(event, view);
    if (action.type === "none") {
      if (event.key === "Escape" && message) {
        event.preventDefault();
        setMessage(null);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setMessage(null);
    setShowIndex(false);
    switch (action.type) {
      case "move":
        moveTo(action.top);
        break;
      case "quit":
        if (help) setHelp(null);
        else onQuit();
        break;
      case "file":
        onFile(action.direction);
        break;
      case "search":
        if (!help) setMode({ kind: "search", direction: action.direction, text: "" });
        break;
      case "again":
        if (!pattern) setMessage("No previous regular expression");
        else search(pattern, action.reverse ? (-lastDirection as 1 | -1) : lastDirection, top);
        break;
      case "colon":
        setMode({ kind: "colon" });
        break;
      case "help":
        setHelp({ top: 0 });
        break;
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const { rows: delta, carry } = wheelRows(event.deltaY, event.deltaMode, lineHeight, wheelCarry.current);
    wheelCarry.current = carry;
    if (delta !== 0) moveTo(shownTop + delta);
  };

  // Touch: drag to scroll, tap the lower part for the next screen, the upper for the last.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    drag.current = { y: event.clientY, top: shownTop, moved: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const delta = Math.round((current.y - event.clientY) / lineHeight);
    if (Math.abs(current.y - event.clientY) > 8) current.moved = true;
    if (current.moved) moveTo(current.top + delta);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current || current.moved) return;
    const box = event.currentTarget.getBoundingClientRect();
    moveTo(shownTop + (event.clientY - box.top < box.height * 0.4 ? -height : height));
  };

  const visible = shownRows.slice(shownTop, shownTop + height);
  const filler = Math.max(0, height - visible.length);
  const status = useMemo(() => {
    if (mode.kind === "search") return `${mode.direction === 1 ? "/" : "?"}${mode.text}`;
    if (mode.kind === "colon") return ":";
    if (message) return message;
    if (help) return "HELP -- Press q when done";
    if (error) return `${name}: ${error}`;
    if (!rows) return name;
    return pagerStatus({ name, view, fileIndex: showIndex ? fileIndex : null });
  }, [mode, message, help, error, rows, name, view.top, view.height, view.total, showIndex, fileIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const typing = mode.kind !== "normal";

  return (
    <div
      ref={root}
      role="document"
      aria-label={name}
      aria-roledescription="pager"
      tabIndex={0}
      data-term-pager=""
      className="flex h-full flex-col outline-none"
      onKeyDown={onKeyDown}
      onWheel={onWheel}
    >
      <div
        className="min-h-0 flex-1 touch-none overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      >
        {visible.map((row, index) => (
          <Row key={shownTop + index} row={row} pattern={help ? "" : pattern} />
        ))}
        {/* Past the end of the file less draws tildes. */}
        {rows &&
          Array.from({ length: filler }, (_, index) => (
            <div key={`end-${index}`} className="h-[1lh] text-term-dim">
              ~
            </div>
          ))}
      </div>
      <div className="flex h-[1lh] flex-none items-center gap-3 whitespace-pre" role="status" aria-live="polite">
        <span className={`min-w-0 truncate ${typing ? "" : "bg-term-fg text-term-bg"}`}>
          {status}
          {typing && <span className="bg-term-caret text-term-bg"> </span>}
        </span>
        {/* A prompt with the keys spelled out, as a less -P prompt can carry them. */}
        <span className="ml-auto flex flex-none items-center gap-1 text-[0.92em] max-[420px]:gap-0">
          <button type="button" className={LINK} aria-label={t("Previous file")} onClick={() => onFile(-1)}>
            :p
          </button>
          <button type="button" className={LINK} aria-label={t("Next file")} onClick={() => onFile(1)}>
            :n
          </button>
          <button type="button" className={LINK} aria-label={t("Back to the list")} onClick={onQuit}>
            q
          </button>
        </span>
      </div>
    </div>
  );
}
