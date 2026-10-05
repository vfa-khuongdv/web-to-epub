import { ChevronRight } from "lucide-react";
import { KeyboardEvent, ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { ChapterLine } from "../../lib/skins/chapterLines";
import { EditorTabs, TabView } from "./EditorTabs";
import { MarkdownGlyph } from "./ExplorerTree";
import { FileLines } from "./FileLines";
import { clampParagraph, editorLine, firstVisible } from "./lines";

// How often the top line is reported while scrolling (it is saved as the reading position).
const REPORT_MS = 300;

export interface EditorText {
  // Changes with the tab and with a re-crawl of the chapter: a new id restores the position.
  id: string;
  lines: ChapterLine[];
  // Paragraph to show at the top when the text appears.
  initialLine: number;
  next: string | null;
}

/**
 * The editor group: open tabs, the breadcrumb, and the scrolling text. Keys in the text:
 * PageUp/PageDown and Space/Shift+Space page, ] and [ go to the next/previous file.
 * Restores the remembered line when a text appears and reports the line at the top
 * while scrolling, so the shell can save the reading position.
 */
export function EditorGroup({
  tabs,
  activeKey,
  onActivate,
  onClose,
  breadcrumb,
  text,
  body,
  cursor,
  onCursor,
  onTopLine,
  onNext,
  onPrevious,
  focusToken,
}: {
  tabs: TabView[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  breadcrumb: { folder: string; file: string } | null;
  text: EditorText | null;
  // What shows instead of a text: the welcome page, loading, a file not downloaded.
  body: ReactNode;
  cursor: number;
  onCursor: (line: number) => void;
  onTopLine: (textId: string, paragraph: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  focusToken: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const textId = text?.id ?? null;
  const textIdRef = useRef(textId);
  textIdRef.current = textId;
  const reportTop = useRef(onTopLine);
  reportTop.current = onTopLine;
  const view = textId ?? `body:${activeKey ?? ""}`;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (!text) {
      element.scrollTop = 0;
      return;
    }
    const line = clampParagraph(text.initialLine, text.lines.length);
    const row = line > 0 ? element.querySelector<HTMLElement>(`[data-line="${line}"]`) : null;
    element.scrollTop = row ? Math.max(0, row.offsetTop - 4) : 0;
    onCursor(editorLine(line));
    reportTop.current(text.id, line);
    // Only a new text (or the switch to another body) moves the view, not a re-render.
  }, [view]);

  useEffect(() => {
    if (focusToken > 0) scroller.current?.focus({ preventScroll: true });
  }, [focusToken]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const report = () => {
    timer.current = 0;
    const element = scroller.current;
    const id = textIdRef.current;
    if (!element || !id) return;
    const rows = Array.from(element.querySelectorAll<HTMLElement>("[data-line]"));
    if (rows.length === 0) return;
    const at = firstVisible(
      rows.map((row) => row.offsetTop),
      element.scrollTop + 4
    );
    reportTop.current(id, Number(rows[at].dataset.line));
  };

  const onScroll = () => {
    if (!timer.current) timer.current = window.setTimeout(report, REPORT_MS);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const element = scroller.current;
    if (!element) return;
    const page = Math.max(40, element.clientHeight - 44);
    switch (event.key) {
      case "PageDown":
        element.scrollBy({ top: page });
        break;
      case "PageUp":
        element.scrollBy({ top: -page });
        break;
      case " ":
        // On a link or button inside, Space presses it.
        if (event.target !== event.currentTarget) return;
        element.scrollBy({ top: event.shiftKey ? -page : page });
        break;
      case "]":
        onNext();
        break;
      case "[":
        onPrevious();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-code-editor">
      <EditorTabs tabs={tabs} activeKey={activeKey} onActivate={onActivate} onClose={onClose} />
      {breadcrumb && (
        <div className="flex h-[22px] flex-none items-center gap-0.5 overflow-hidden whitespace-nowrap px-4 text-[13px] text-code-dim">
          <span>workspace</span>
          <ChevronRight size={14} aria-hidden="true" className="flex-none" />
          <span className="truncate">{breadcrumb.folder}</span>
          <ChevronRight size={14} aria-hidden="true" className="flex-none" />
          <MarkdownGlyph />
          <span className="truncate">{breadcrumb.file}</span>
        </div>
      )}
      <div
        ref={scroller}
        role="region"
        aria-label="Editor"
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-focus"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
      >
        {text ? <FileLines lines={text.lines} cursor={cursor} onCursor={onCursor} next={text.next} onNext={onNext} /> : body}
      </div>
    </div>
  );
}
