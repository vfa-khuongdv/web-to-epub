import { Highlight, HighlightColor } from "./api";

// The chapter body is wrapped in this element so offsets are measured over the chapter
// text alone: the <h1> the export prepends carries the chapter title, which is editable,
// and letting it shift every offset would move every highlight in the chapter.
export const CONTENT_ID = "reader-content";

// Translucent so the words stay legible on paper, sepia and night pages alike, and so
// two overlapping highlights still read as text rather than a solid block.
export const HIGHLIGHT_CSS = `
mark.hl { color: inherit; border-radius: 2px; padding: 0 1px; cursor: pointer; }
mark.hl-yellow { background: rgba(255, 210, 0, 0.38); }
mark.hl-green { background: rgba(60, 200, 120, 0.34); }
mark.hl-blue { background: rgba(80, 160, 255, 0.34); }
mark.hl-pink { background: rgba(255, 105, 170, 0.34); }
`;

// Swatch colours for the palette in the app chrome, which sits on the app's own
// background rather than the page's, so they are opaque.
export const SWATCH: Record<HighlightColor, string> = {
  yellow: "#f5cc2e",
  green: "#48c07a",
  blue: "#5aa2f5",
  pink: "#f56fae",
};

function contentRoot(doc: Document): HTMLElement | null {
  return doc.getElementById(CONTENT_ID);
}

/**
 * Character offset of a DOM position within the chapter text. Range.toString() counts
 * exactly the characters a TreeWalker over text nodes would, so this matches the
 * offsets paint() walks with — and, unlike a node path, it survives the reader
 * rebuilding the HTML.
 */
function offsetOf(root: Node, container: Node, offset: number, doc: Document): number {
  const range = doc.createRange();
  range.selectNodeContents(root);
  range.setEnd(container, offset);
  return range.toString().length;
}

export interface PickedText {
  start: number;
  end: number;
  text: string;
  // Where the selection sits inside the iframe, for placing the palette over it.
  rect: DOMRect;
}

export function readSelection(doc: Document): PickedText | null {
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const root = contentRoot(doc);
  if (!root) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const raw = range.toString();
  const text = raw.trim();
  if (!text) return null;

  // A drag usually ends past the last word, on the whitespace or the line break; store
  // the passage, not the gap after it, so the saved text and the offsets agree.
  const lead = raw.length - raw.trimStart().length;
  const trail = raw.length - raw.trimEnd().length;
  const start = offsetOf(root, range.startContainer, range.startOffset, doc) + lead;
  const end = offsetOf(root, range.endContainer, range.endOffset, doc) - trail;
  if (end <= start) return null;

  return { start, end, text, rect: range.getBoundingClientRect() };
}

/**
 * Wrap one stored range in <mark>. Splitting text nodes leaves the text itself
 * untouched, so offsets stay valid and highlights can be painted one after another.
 */
export function paint(doc: Document, highlight: Highlight): void {
  const root = contentRoot(doc);
  if (!root) return;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pieces: { node: Text; from: number; to: number }[] = [];
  let pos = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nodeEnd = pos + node.data.length;
    if (nodeEnd > highlight.start && pos < highlight.end) {
      pieces.push({
        node,
        from: Math.max(0, highlight.start - pos),
        to: Math.min(node.data.length, highlight.end - pos),
      });
    }
    pos = nodeEnd;
    if (pos >= highlight.end) break;
  }

  for (const { node, from, to } of pieces) {
    let target = node;
    if (to < target.data.length) target.splitText(to);
    if (from > 0) target = target.splitText(from);
    const mark = doc.createElement("mark");
    mark.className = `hl hl-${highlight.color}`;
    mark.dataset.highlight = highlight.id;
    target.parentNode?.replaceChild(mark, target);
    mark.appendChild(target);
  }
}

export function paintAll(doc: Document, highlights: Highlight[]): void {
  for (const highlight of highlights) paint(doc, highlight);
}

// Recolouring in place beats repainting the page: the reader keeps its scroll position
// and the change lands under the pointer immediately.
export function recolor(doc: Document, id: string, color: HighlightColor): void {
  doc.querySelectorAll(`mark[data-highlight="${CSS.escape(id)}"]`).forEach((mark) => {
    mark.className = `hl hl-${color}`;
  });
}

export function unpaint(doc: Document, id: string): void {
  doc.querySelectorAll(`mark[data-highlight="${CSS.escape(id)}"]`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    // The passage is one text node again, so a later paint() walks it as one piece.
    parent.normalize();
  });
}

export function markAt(target: EventTarget | null): { id: string; rect: DOMRect } | null {
  // Not `instanceof Element`: the event comes from the iframe's document, which has its
  // own Element and HTMLElement, so an instanceof against this window's classes is
  // always false. Feature-test instead.
  const node = target as Element | null;
  const element = typeof node?.closest === "function" ? node.closest("mark[data-highlight]") : null;
  const id = (element as HTMLElement | null)?.dataset?.highlight;
  if (!element || !id) return null;
  return { id, rect: element.getBoundingClientRect() };
}

export function scrollToHighlight(doc: Document, id: string): void {
  doc.querySelector(`mark[data-highlight="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center" });
}
