import { JSDOM } from "jsdom";
import { ContentBlock } from "../types";

// Inline HTML in a chapter block comes from crawled pages and from the editor, and the
// app renders it in its own origin: nothing that can run script or load a local file may
// survive. Same allowlist spirit as `sanitize` in epubImport.ts.
const DROP_TAGS =
  "script, style, link, meta, base, iframe, frame, frameset, object, embed, form, input, button, textarea, select, svg, math, canvas, template";

// The URL parser ignores tabs/newlines and leading control characters, so the scheme
// must be read the same way ("java\tscript:" is still javascript:).
function scheme(value: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000- ]/g, "");
  return /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)?.[1].toLowerCase();
}

function safeHref(value: string): boolean {
  const s = scheme(value);
  return s === undefined || s === "http" || s === "https" || s === "mailto";
}

function safeSrc(value: string): boolean {
  const s = scheme(value);
  // data:image only; file: stays out (the export maps markers to file:// itself, later).
  // eslint-disable-next-line no-control-regex
  if (s === "data") return /^data:image\/(png|jpe?g|gif|webp);/i.test(value.replace(/^[\u0000- ]+/, ""));
  return s === undefined || s === "http" || s === "https";
}

export function sanitizeInlineHtml(html: string): string {
  if (!html || !/[<&]/.test(html)) return html;
  const fragment = JSDOM.fragment(html);
  fragment.querySelectorAll(DROP_TAGS).forEach((el) => el.remove());
  for (const el of Array.from(fragment.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "srcset" || name === "formaction" || name === "srcdoc") {
        el.removeAttribute(attr.name);
      } else if ((name === "href" || name === "xlink:href" || name === "action") && !safeHref(attr.value)) {
        el.removeAttribute(attr.name);
      } else if ((name === "src" || name === "poster" || name === "data") && !safeSrc(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  const holder = fragment.ownerDocument.createElement("div");
  holder.appendChild(fragment);
  return holder.innerHTML;
}

export function sanitizeBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    const next = { ...block };
    if (next.type === "paragraph" || next.type === "heading") {
      if (next.text) next.text = sanitizeInlineHtml(next.text);
    } else {
      // Both land inside a double-quoted attribute in the editor's HTML.
      if (next.src) next.src = safeSrc(next.src) ? next.src.replace(/["<>]/g, encodeURIComponent) : "";
      if (next.alt) next.alt = next.alt.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    return next;
  });
}
