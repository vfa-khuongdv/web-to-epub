import { CONTENT_ID } from "./highlightDom";

// Reader-only, like the highlight marks: the EPUB never carries it.
export const NARRATING_CLASS = "narrating";
export const NARRATING_CSS = `
.${NARRATING_CLASS} {
  background: rgba(80, 160, 255, 0.16);
  box-shadow: 0 0 0 0.3em rgba(80, 160, 255, 0.16);
  border-radius: 3px;
  transition: background-color 0.25s, box-shadow 0.25s;
}
`;

export interface TimelinePart {
  // Element index inside the chapter content, -1 for the chapter title (<h1>).
  block: number;
  start: number;
  end: number;
}

/**
 * The part being read at `time`. In the pause after a part it stays on that part, so the
 * highlight does not flicker off between paragraphs; before the first part, none (-1).
 */
export function activePart(parts: TimelinePart[], time: number): number {
  let found = -1;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].start <= time) found = i;
    else break;
  }
  return found;
}

function blockElement(doc: Document, block: number): Element | null {
  if (block === -1) return doc.body?.querySelector(":scope > h1") ?? null;
  return doc.getElementById(CONTENT_ID)?.children[block] ?? null;
}

/**
 * Mark the element for `block` as the one being read (clearing the previous one), and
 * bring it into view when it is off screen — the reader follows the voice without
 * jumping while the paragraph is already visible. `null` clears.
 */
export function markNarrating(doc: Document, block: number | null, follow = true): Element | null {
  // A frame between loads holds a blank document with no body yet: nothing to mark.
  if (!doc.body) return null;
  for (const el of Array.from(doc.getElementsByClassName(NARRATING_CLASS))) el.classList.remove(NARRATING_CLASS);
  if (block === null) return null;
  const el = blockElement(doc, block);
  if (!el) return null;
  el.classList.add(NARRATING_CLASS);
  const view = doc.defaultView;
  if (follow && view) {
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > view.innerHeight) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  return el;
}
