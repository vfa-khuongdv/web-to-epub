import { RefObject, useLayoutEffect, useState } from "react";

export interface TermSize {
  columns: number;
  rows: number;
  lineHeight: number;
}

// Line spacing of the profile: a little looser than a terminal's default, for reading.
export const LINE_SPACING = 1.45;

/**
 * The text area's size in character cells, as a terminal reports it (and lays text out
 * by): one monospace cell measured in the element's own font, the element's box observed.
 */
export function useTermSize(element: RefObject<HTMLElement | null>, fontSize: number): TermSize {
  const lineHeight = Math.round(fontSize * LINE_SPACING);
  const [size, setSize] = useState<TermSize>({ columns: 80, rows: 24, lineHeight });

  useLayoutEffect(() => {
    const box = element.current;
    if (!box) return;
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(40);
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0";
    box.appendChild(probe);
    const cell = probe.getBoundingClientRect().width / 40 || fontSize * 0.6;
    box.removeChild(probe);

    const measure = () => {
      const style = getComputedStyle(box);
      const px = (value: string) => parseFloat(value) || 0;
      const width = box.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
      const height = box.clientHeight - px(style.paddingTop) - px(style.paddingBottom);
      const next = {
        columns: Math.max(20, Math.floor(width / cell)),
        rows: Math.max(4, Math.floor(height / lineHeight)),
        lineHeight,
      };
      setSize((current) =>
        current.columns === next.columns && current.rows === next.rows && current.lineHeight === next.lineHeight
          ? current
          : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [element, fontSize, lineHeight]);

  return size;
}
