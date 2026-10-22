import { ReactNode, RefObject, useCallback, useLayoutEffect, useRef } from "react";

// The line of the first message still showing at the top: a binary search over the
// messages in document order (their tops only grow), so a long thread costs a few reads.
function topLineOf(scroller: HTMLElement): number | null {
  const rows = scroller.querySelectorAll<HTMLElement>("[data-line]");
  if (rows.length === 0) return null;
  const top = scroller.getBoundingClientRect().top + 4;
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (rows[mid].getBoundingClientRect().bottom > top) high = mid;
    else low = mid + 1;
  }
  const line = Number(rows[low].dataset.line);
  return Number.isFinite(line) ? line : null;
}

// The message showing a line, or the closest one before it (a line may have gone: a
// title heading hidden by neutral names).
function rowFor(scroller: HTMLElement, line: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  for (const row of Array.from(scroller.querySelectorAll<HTMLElement>("[data-line]"))) {
    const value = Number(row.dataset.line);
    if (value > line) break;
    best = row;
  }
  return best;
}

/**
 * The scrolling message list. When `restoreKey` changes and `ready` is true it scrolls to
 * `startLine` once; afterwards it reports the line at the top as the reader scrolls.
 * Focusable (without a ring, as the chat draws it), so Space, Page Up/Down and the arrows
 * scroll it as in the browser.
 */
export function Conversation({
  scrollerRef,
  label,
  restoreKey,
  startLine,
  ready,
  onTopLine,
  children,
}: {
  scrollerRef: RefObject<HTMLElement>;
  label: string;
  restoreKey: string;
  startLine: number;
  ready: boolean;
  onTopLine?: (line: number) => void;
  children: ReactNode;
}) {
  const restored = useRef<string | null>(null);
  const frame = useRef(0);
  const lastLine = useRef<number | null>(null);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !ready || restored.current === restoreKey) return;
    restored.current = restoreKey;
    lastLine.current = startLine;
    const row = startLine > 0 ? rowFor(scroller, startLine) : null;
    if (!row) {
      scroller.scrollTop = 0;
      return;
    }
    scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
  }, [scrollerRef, restoreKey, startLine, ready]);

  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onScroll = useCallback(() => {
    if (!onTopLine || frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const scroller = scrollerRef.current;
      if (!scroller || restored.current !== restoreKey) return;
      const line = topLineOf(scroller);
      if (line === null || line === lastLine.current) return;
      lastLine.current = line;
      onTopLine(line);
    });
  }, [onTopLine, scrollerRef, restoreKey]);

  return (
    <section
      ref={scrollerRef}
      aria-label={label}
      tabIndex={0}
      onScroll={onScroll}
      // No ring: it takes focus on every thread opened, and the chat never frames its list.
      className="min-h-0 flex-1 overflow-y-auto outline-none"
    >
      <div className="mx-auto w-full max-w-[880px] px-3 pb-8 pt-2 sm:px-6">{children}</div>
    </section>
  );
}
