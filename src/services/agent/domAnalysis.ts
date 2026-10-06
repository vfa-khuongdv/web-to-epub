/**
 * Page analysis for the agent crawler: the outline and scripts the agent is shown, and the checks that
 * its code left nothing out. Pure functions of an HTML string (jsdom only), so `domClient.ts` can run them
 * in a worker thread — parsing a big page takes seconds, and the server shares its thread with the window.
 */
import { JSDOM } from "jsdom";
import type { ContentBlock, ExtractedChapter } from "../../types";
import type { ImportedBook } from "../epubImport";
import type { TocChapter, TocResult } from "../toc/types";

// A page's paragraphs include menus and comments, so only a result far below them counts as cut short.
const COVERAGE_MIN_PAGE_CHARS = 8_000;
const COVERAGE_RATIO = 0.25;
const SKELETON_CHARS = 30_000;
const SCRIPTS_CHARS = 8_000;

export const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");
export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

// Siblings fold into "+N similar" only when they look alike two levels down: items of one list often
// differ inside (the first hundred links carry a class, the rest do not) and the agent must see that.
const attributeNames = (el: Element) => (el.tagName === "IMG" ? `{${Array.from(el.attributes).map((a) => a.name).sort().join(" ")}}` : "");
const signature = (el: Element, depth = 2): string =>
  `${el.tagName}.${el.getAttribute("class") ?? ""}${attributeNames(el)}${depth > 0 ? `[${Array.from(el.children).map((c) => signature(c, depth - 1)).join(",")}]` : ""}`;

function label(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).map((c) => `.${c}`).join("");
  const href = tag === "a" ? ` href="${(el.getAttribute("href") ?? "").slice(0, 80)}"` : "";
  const own = collapse(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join(" ")).slice(0, 60);
  // A picture's address is often not in `src` (a lazy-loading page keeps a placeholder there): show which attribute holds what.
  const picture =
    tag === "img"
      ? " " +
        Array.from(el.attributes)
          .filter((a) => a.name !== "class" && a.name !== "id")
          .map((a) => `${a.name}="${a.value.startsWith("data:") ? "data:…" : a.value.slice(0, 80)}"`)
          .join(" ")
      : "";
  const size = el.children.length > 0 && (el.textContent ?? "").length > 500 ? ` [${collapse(el.textContent ?? "").length} chars of text]` : "";
  return `<${tag}${id}${cls}${href}${picture}>${own ? " " + own : ""}${size}`;
}

// A trimmed outline of a page: tags, ids, classes, link addresses and the start of each text, with
// runs of look-alike siblings folded into "+N similar", so the structure fits in a prompt.
export function skeleton(html: string, url: string): string {
  const dom = new JSDOM(html, { url });
  try {
    const doc = dom.window.document;
    doc.querySelectorAll("script,style,noscript,svg,iframe,link,meta,template").forEach((el) => el.remove());
    const lines: string[] = [];
    let chars = 0;
    const walk = (el: Element, depth: number) => {
      if (chars > SKELETON_CHARS || depth > 14) return;
      const line = `${"  ".repeat(depth)}${label(el)}`;
      lines.push(line);
      chars += line.length;
      const kids = Array.from(el.children);
      for (let i = 0; i < kids.length; i++) {
        const other = kids.slice(i).findIndex((k) => signature(k) !== signature(kids[i]));
        const run = other === -1 ? kids.length - i : other;
        const shown = Math.min(run, 2);
        for (let j = 0; j < shown; j++) walk(kids[i + j], depth + 1);
        if (run > shown) lines.push(`${"  ".repeat(depth + 1)}… +${run - shown} similar <${kids[i].tagName.toLowerCase()}>`);
        i += run - 1;
      }
    };
    walk(doc.body, 0);
    return lines.join("\n");
  } finally {
    dom.window.close();
  }
}

// The page's scripts, which show where its data really comes from: a chapter list that is empty in the HTML is
// usually filled in by a request the inline script makes. The outline above leaves scripts out.
export function pageScripts(html: string, url: string): string {
  const dom = new JSDOM(html, { url });
  try {
    const doc = dom.window.document;
    const external = Array.from(doc.querySelectorAll("script[src]")).map((s) => s.getAttribute("src")).filter(Boolean);
    let budget = SCRIPTS_CHARS;
    const inline: string[] = [];
    for (const script of Array.from(doc.querySelectorAll("script:not([src])"))) {
      const text = collapse(script.textContent ?? "");
      if (text.length < 20 || /^\s*[{[]/.test(text) && script.getAttribute("type")?.includes("json")) continue;
      const part = text.slice(0, Math.min(budget, 4000));
      if (part.length === 0) break;
      inline.push(part + (part.length < text.length ? " …" : ""));
      budget -= part.length;
    }
    if (inline.length === 0 && external.length === 0) return "(none)";
    return [...(external.length ? [`External scripts: ${external.slice(0, 20).join(", ")}`] : []), ...inline.map((t) => `Inline script: ${t}`)].join("\n");
  } finally {
    dom.window.close();
  }
}


export const http = (value: unknown, base: string): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

// The shape of a chapter address: digits stand for "a number", so /story/chapter-12 and /story/chapter-13 agree.
const addressShape = (url: string) => new URL(url).pathname.replace(/\d+/g, "#");

// Chapter links on the page, addressed like the ones toc() returned, that it left out. A list whose
// items do not all share the same markup is the usual cause: code written for the first items' class
// misses the rest. Pages of a list that is split into several are fine — those links are not on this page.
// Only links sitting where the returned chapters sit (same ancestors' tags and ids) count: a wiki gives every
// link of the page — menu, files, other pages — the same address shape, and those are not chapters.
export function missedChapters(html: string, storyUrl: string, toc: TocResult): { shape: string; missed: TocChapter[]; unreadPages: number } {
  const shapes = new Map<string, number>();
  for (const c of toc.chapters) shapes.set(addressShape(c.url), (shapes.get(addressShape(c.url)) ?? 0) + 1);
  const shape = [...shapes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const have = new Set(toc.chapters.map((c) => c.url));
  const dom = new JSDOM(html, { url: storyUrl });
  try {
    const missed: TocChapter[] = [];
    const seen = new Set<string>();
    const links = Array.from(dom.window.document.querySelectorAll("a[href]"));
    const addressOf = (a: Element) => http((a as HTMLAnchorElement).href, storyUrl)?.replace(/#.*$/, "");
    const places = new Set(links.filter((a) => have.has(addressOf(a) ?? "")).map(chain));
    for (const a of links) {
      const url = addressOf(a);
      if (!url || have.has(url) || seen.has(url) || hostOf(url) !== hostOf(storyUrl)) continue;
      if (addressShape(url) !== shape) continue;
      // A list loaded by a request has no links of its own on the page: nothing to compare places with.
      if (places.size > 0 && !places.has(chain(a))) continue;
      seen.add(url);
      missed.push({ url, title: collapse(a.textContent ?? "") || url });
    }
    // A long list is split into pages (`?page=N` links back to this very page). A result that holds no more
    // chapters than this page itself shows never went to the other pages.
    const herePath = new URL(storyUrl).pathname.replace(/\/+$/, "");
    let lastPage = 1;
    for (const a of links) {
      try {
        const link = new URL((a as HTMLAnchorElement).href);
        if (link.pathname.replace(/\/+$/, "") === herePath) lastPage = Math.max(lastPage, Number(link.searchParams.get("page")) || 1);
      } catch {
        /* not an address */
      }
    }
    const onPageUrls = new Set(links.map(addressOf));
    const onPage = toc.chapters.filter((c) => onPageUrls.has(c.url)).length;
    // A pager of numbered buttons (no address of its own, the script swaps the list): the highest number, when the
    // buttons sit beside the chapter list (an ancestor a few levels up holds most of its links).
    const chapterLinks = links.filter((a) => have.has(addressOf(a) ?? ""));
    for (const button of Array.from(dom.window.document.querySelectorAll("button, a"))) {
      if (chapterLinks.includes(button as HTMLAnchorElement)) continue;
      const label = (button.textContent ?? "").trim();
      if (!/^\d{1,4}$/.test(label) || Number(label) <= lastPage) continue;
      let box: Element | null = button.parentElement;
      for (let up = 0; box && up < 4; up++, box = box.parentElement) {
        if (chapterLinks.filter((a) => box!.contains(a)).length >= Math.max(1, chapterLinks.length / 2)) {
          lastPage = Number(label);
          break;
        }
      }
    }
    return { shape, missed, unreadPages: lastPage >= 3 && toc.chapters.length <= onPage ? lastPage - 1 : 0 };
  } finally {
    dom.window.close();
  }
}

// Every address an <img> carries in any attribute: lazy-loading pages keep a placeholder in `src` and the
// real picture in another one, under a name that differs from site to site.
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;
function pictureAddresses(img: Element, pageUrl: string): string[] {
  const found: string[] = [];
  for (const attr of Array.from(img.attributes)) {
    for (const part of attr.value.split(",")) {
      const candidate = part.trim().split(/\s+/)[0];
      if (!candidate || candidate.startsWith("data:") || !IMAGE_EXT.test(candidate)) continue;
      const url = http(candidate, pageUrl);
      if (url) found.push(url);
    }
  }
  return found;
}

// Where an element sits: its ancestors' tags and ids, so the pictures of one list (same wrappers) are told
// apart from a sidebar's or an advert's.
function chain(el: Element): string {
  const parts: string[] = [];
  for (let node = el.parentElement; node; node = node.parentElement) parts.push(`${node.tagName}${node.id ? "#" + node.id : ""}`);
  return parts.join("<");
}

// Pictures addressed like the ones chapter() returned and sitting in the same place on the page, that it
// left out. The usual cause is lazy loading: the first pictures have their real address in `src`, the rest
// in another attribute the code did not look at.
export function missedPictures(html: string, url: string, chapter: ExtractedChapter): { shape: string; missed: string[] } {
  const have = new Set(chapter.blocks.filter((b) => b.type === "image" && b.src).map((b) => b.src as string));
  if (have.size === 0) return { shape: "", missed: [] };
  const shapes = new Map<string, number>();
  for (const src of have) shapes.set(addressShape(src), (shapes.get(addressShape(src)) ?? 0) + 1);
  const shape = [...shapes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const dom = new JSDOM(html, { url });
  try {
    const imgs = Array.from(dom.window.document.querySelectorAll("img"));
    const places = new Set(imgs.filter((img) => pictureAddresses(img, url).some((a) => have.has(a))).map(chain));
    const missed = new Set<string>();
    for (const img of imgs) {
      if (!places.has(chain(img))) continue;
      for (const a of pictureAddresses(img, url)) if (addressShape(a) === shape && !have.has(a)) missed.add(a);
    }
    return { shape, missed: [...missed] };
  } finally {
    dom.window.close();
  }
}

export function articleMissing(html: string, url: string, article: ImportedBook): string | null {
  const dom = new JSDOM(html, { url });
  try {
    const page = Array.from(dom.window.document.querySelectorAll("p")).reduce((n, p) => n + collapse(p.textContent ?? "").length, 0);
    const kept = article.chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + (b.type === "paragraph" ? collapse(b.text?.replace(/<[^>]*>/g, "") ?? "").length : 0), 0), 0);
    if (page < COVERAGE_MIN_PAGE_CHARS || kept >= page * COVERAGE_RATIO) return null;
    return `article() kept ${kept} characters of paragraph text, but the page has ${page} characters in its paragraphs: it left most of the text out`;
  } finally {
    dom.window.close();
  }
}

