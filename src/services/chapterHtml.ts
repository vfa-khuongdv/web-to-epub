import { JSDOM } from "jsdom";
import { ContentBlock } from "../types";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

// Tags that open a new block. Other tags (b, i, em, strong, a, span, code, br…) are
// inline and kept as-is within paragraphs.
const BLOCK_RE =
  /^(address|article|aside|audio|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|img|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul|video)$/;

// Trash that should never enter the book, even when users paste an entire HTML block
// copied from a source page.
const DROP_RE = /^(script|style|noscript|iframe|object|embed|link|meta)$/;

const HEADING_RE = /^h([1-6])$/;

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Paragraphs containing only empty tags or whitespace (`&nbsp;` often appears when pasting
// from a browser) should not become a paragraph.
function hasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim().length > 0;
}

// The editor uses <br> for each soft line break; split into separate paragraphs
// so EPUB doesn't pack the entire chapter into one text block.
function pushParagraphs(html: string, blocks: ContentBlock[]): void {
  for (const part of html.split(/<br\s*\/?>/i)) {
    const text = part.trim();
    if (hasText(text)) blocks.push({ type: "paragraph", text });
  }
}

// <audio>/<video> holds a URL in the src attribute, or in a <source> child when the page
// offers multiple formats — take the first one; EPUB can only pack one file per tag.
export function mediaSrc(el: Element): string | undefined {
  const own = el.getAttribute("src")?.trim();
  if (own) return own;
  return el.querySelector("source")?.getAttribute("src")?.trim() || undefined;
}

function isBlock(el: Element): boolean {
  return BLOCK_RE.test(el.tagName.toLowerCase());
}

function walk(root: ParentNode, blocks: ContentBlock[]): void {
  let inline: string[] = [];

  function flush(): void {
    const html = inline.join("").trim();
    inline = [];
    if (html) pushParagraphs(html, blocks);
  }

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === TEXT_NODE) {
      inline.push(escapeText(node.textContent ?? ""));
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_RE.test(tag)) continue;

    if (!isBlock(el)) {
      inline.push(el.outerHTML);
      continue;
    }

    // Moving to a new block: finalize the accumulated inline paragraph first;
    // otherwise text immediately before a <p> will be lost.
    flush();

    const heading = HEADING_RE.exec(tag);
    if (heading) {
      const text = el.textContent?.trim();
      if (text) blocks.push({ type: "heading", level: Number(heading[1]), text });
      continue;
    }

    if (tag === "img") {
      // Use getAttribute instead of .src: preserve the URL as the user sees it,
      // don't let jsdom append a base URL to the fragment.
      const src = el.getAttribute("src")?.trim();
      if (src) blocks.push({ type: "image", src, alt: el.getAttribute("alt") || "" });
      continue;
    }

    if (tag === "audio" || tag === "video") {
      const src = mediaSrc(el);
      if (src) blocks.push({ type: tag, src });
      continue;
    }

    // Nested blocks (div wrapping p, figure wrapping img…): recurse into them rather than
    // merging the entire group into one paragraph.
    if (Array.from(el.children).some(isBlock)) {
      walk(el, blocks);
      continue;
    }

    pushParagraphs(el.innerHTML, blocks);
  }

  flush();
}

/**
 * Convert HTML the user just edited in the editor to the correct block format stored
 * in the DB. Preserve inline formatting (b/i/a…) because the block's `text` already contains HTML;
 * discard trash tags and empty paragraphs.
 */
export function htmlToBlocks(html: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  walk(JSDOM.fragment(html), blocks);
  return blocks;
}

// `controls` is the only thing that makes a media tag show a play button — both in the
// editor and in EPUB. Content inside the tag is a fallback for readers that can't play it (Kindle),
// and also keeps the tag non-empty so cheerio in epub-gen doesn't collapse it to <audio/> —
// a form some readers parse incorrectly.
export function mediaTag(type: "audio" | "video", src: string): string {
  const label = type === "audio" ? "Audio file" : "Video file";
  return `<${type} controls src="${src}">${label}</${type}>`;
}

/**
 * Reverse direction: build chapter HTML from saved blocks. Keep the same approach as the frontend
 * (frontend/src/blocksToHtml.ts) so EPUB exported from the server matches what's exported from
 * the content open in the UI.
 */
export function blocksToHtml(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "heading") return `<h${block.level || 2}>${block.text}</h${block.level || 2}>`;
      if (block.type === "image") return `<img src="${block.src}" alt="${block.alt || ""}" />`;
      if (block.type === "audio" || block.type === "video") return mediaTag(block.type, block.src || "");
      return `<p>${block.text}</p>`;
    })
    .join("\n");
}
