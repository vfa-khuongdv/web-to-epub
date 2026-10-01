/**
 * Crawling a site nobody wrote an adapter for. The page is parsed here; the AI only chooses
 * among candidate elements (which one is the chapter list, which one is the chapter body),
 * and the text itself always comes from the DOM — a model cannot invent or drop a sentence.
 */
import { JSDOM } from "jsdom";
import type { Page } from "playwright";
import { ExtractedChapter } from "../../types";
import { LockedContentError, walkToBlocks } from "../extractor";
import { t } from "../lang";
import { TocAdapter, TocChapter, TocResult } from "../toc/types";
import { fetchText } from "../toc/http";
import { renderPageHtml } from "../renderer";
import { activeAiProvider } from "./aiConfig";
import type { AiProvider } from "./providers";

const MAX_CANDIDATES = 8;
const MIN_TOC_LINKS = 5;
const MIN_BODY_CHARS = 200;
const NOISE = "script, style, noscript, iframe, nav, header, footer, aside, form";

export class AiNotConfiguredError extends Error {}
// No chapter list on the page as loaded — worth retrying after opening a "chapters" tab.
export class NoChapterListError extends Error {}

function requireProvider(): AiProvider {
  const provider = activeAiProvider();
  if (!provider) throw new AiNotConfiguredError(t("AI crawler is off or has no API key (Settings → AI)"));
  return provider;
}

function preview(text: string, n: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

function pageTitle(doc: Document): string {
  const h1 = doc.querySelector("h1")?.textContent;
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  return preview(h1 || og || doc.title || "Untitled", 200);
}

// A chapter link as found on the list: its URL, all of its text, and the text split into the
// parts it is made of (number, title, date, word count…) so the AI can say which part is the
// title. `pieces` is empty when the link is a single piece of text.
interface Link extends TocChapter {
  pieces: string[];
}
type TitlePiece = number | "whole";
interface AiToc extends Omit<TocResult, "chapters"> {
  chapters: Link[];
  titlePiece: TitlePiece;
}

const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();

// The parts of a link: the runs of text in it, one per block of the markup (inline tags like
// <b> and <em> stay inside the run they are part of). The same logic runs inside the browser
// in pageAnchors, which cannot share this function.
const INLINE_TAGS = /^(A|B|STRONG|EM|I|U|S|SMALL|MARK|SUP|SUB|BR|FONT|ABBR|CITE|CODE)$/;
function piecesOf(a: Element): string[] {
  const out: string[] = [];
  const collect = (node: Element) => {
    let run = "";
    const flush = () => {
      if (norm(run)) out.push(norm(run));
      run = "";
    };
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) run += child.textContent ?? "";
      else if (child.nodeType === 1) {
        const el = child as Element;
        // An inline tag with nothing but text in it is part of the surrounding run.
        if (INLINE_TAGS.test(el.tagName) && el.children.length === 0) run += el.textContent ?? "";
        else {
          flush();
          collect(el);
        }
      }
    }
    flush();
  };
  collect(a);
  return out.length >= 2 ? out : [];
}

function titleOf(link: Link, piece: TitlePiece): string {
  const part = piece === "whole" ? undefined : link.pieces[piece];
  return preview(part ?? link.title, 200);
}

// Links in `root`, absolute, same site, one per URL, in page order.
function linksIn(root: Element, pageUrl: string): Link[] {
  const host = new URL(pageUrl).hostname;
  const seen = new Set<string>();
  const out: Link[] = [];
  for (const a of Array.from(root.querySelectorAll("a[href]"))) {
    let href: URL;
    try {
      href = new URL(a.getAttribute("href") as string, pageUrl);
    } catch {
      continue;
    }
    href.hash = "";
    const title = preview(a.textContent ?? "", 200);
    if (!/^https?:$/.test(href.protocol) || href.hostname !== host || !title || seen.has(href.href)) continue;
    seen.add(href.href);
    out.push({ url: href.href, title, pieces: piecesOf(a) });
  }
  return out;
}

// Tightest elements that hold many links: a candidate is dropped when one child already
// holds nearly all of its links, so the list itself wins over the page wrapper around it.
function linkGroups(doc: Document, pageUrl: string): { el: Element; links: Link[] }[] {
  const groups: { el: Element; links: Link[] }[] = [];
  for (const el of Array.from(doc.body.querySelectorAll("ul, ol, div, section, table, dl, main"))) {
    const links = linksIn(el, pageUrl);
    if (links.length < MIN_TOC_LINKS) continue;
    const child = Array.from(el.children).some((c) => linksIn(c, pageUrl).length >= links.length * 0.9);
    if (!child) groups.push({ el, links });
  }
  return groups.sort((a, b) => b.links.length - a.links.length).slice(0, MAX_CANDIDATES);
}

// Candidate titles of a page: its headings and title tags, whole and cut at the separators
// sites put between the name and the site ("Chapter 1 | Story | Site"). Only builds the list;
// the AI says which one is the title.
function titleCandidates(doc: Document, extra: string[] = []): { text: string; from: string }[] {
  const raw: { text: string; from: string }[] = [];
  const add = (text: string | null | undefined, from: string) => {
    const clean = preview(text ?? "", 200);
    if (clean) raw.push({ text: clean, from });
  };
  Array.from(doc.querySelectorAll("h1")).slice(0, 3).forEach((e) => add(e.textContent, "h1"));
  Array.from(doc.querySelectorAll("h2")).slice(0, 3).forEach((e) => add(e.textContent, "h2"));
  add(doc.querySelector('meta[property="og:title"]')?.getAttribute("content"), "og:title");
  add(doc.title, "title tag");
  extra.forEach((text) => add(text, "start of the page text"));
  const out: { text: string; from: string }[] = [];
  const seen = new Set<string>();
  const push = (text: string, from: string) => {
    const key = text.toLowerCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      out.push({ text, from });
    }
  };
  for (const c of raw) push(c.text, c.from);
  for (const c of raw) for (const piece of c.text.split(/\s+[|–—·•»]\s+|\s+-\s+/)) push(preview(piece, 200), `part of ${c.from}`);
  return out.slice(0, 12);
}

// The AI picks the title among the candidates; undefined when it says none is clean.
async function chooseTitle(
  provider: AiProvider,
  kind: "chapter" | "story",
  candidates: { text: string; from: string }[],
  state: string
): Promise<string | undefined> {
  const seen = new Set<string>();
  candidates = candidates.filter((c) => !seen.has(c.text.toLowerCase()) && !!seen.add(c.text.toLowerCase()));
  if (candidates.length === 0) return undefined;
  const options: Record<string, string> = {};
  candidates.forEach((c, i) => (options[`title${i + 1}`] = `"${c.text}" (${c.from})`));
  options.none = "None of these is the bare title";
  const subject =
    kind === "chapter"
      ? "the title of this chapter alone — without the story's name, the site's name, its number in a list, a date, a word count or a reading time"
      : "the title of this story alone — without the site's name, a chapter name, or slogans";
  const picked = await provider.choose(`Which of these is exactly ${subject}?`, state, options);
  return candidates[Number(picked.replace("title", "")) - 1]?.text;
}

// Which part of each chapter link is the title, decided by the AI on the first links of the list.
async function chooseTitlePiece(provider: AiProvider, links: Link[], state: string): Promise<TitlePiece> {
  const first = links[0];
  if (first.pieces.length < 2) return "whole";
  const second = links[1];
  const example = (i: number) => (second?.pieces[i] ? ` (second link: "${preview(second.pieces[i], 80)}")` : "");
  const options: Record<string, string> = {
    whole: `All of the link's text is the title: "${preview(first.title, 120)}"`,
  };
  first.pieces.forEach((piece, i) => (options[`part${i + 1}`] = `"${preview(piece, 120)}"${example(i)}`));
  const picked = await provider.choose(
    "Each chapter link on the list is made of several parts. Which part is the chapter's title alone, without its number in the list, a date, a word count, a reading time or a badge?",
    state,
    options
  );
  const index = Number(picked.replace("part", "")) - 1;
  return picked !== "whole" && first.pieces[index] !== undefined ? index : "whole";
}

// The real address of an image URL: Next.js sites serve pictures through
// /_next/image?url=<original>&w=640, and the original is what should be kept.
function realImageUrl(raw: string, base: string): string | undefined {
  try {
    const u = new URL(raw, base);
    if (!/^https?:$/.test(u.protocol)) return undefined;
    const inner = /\/_next\/image\/?$/.test(u.pathname) ? u.searchParams.get("url") : null;
    return inner ? new URL(inner, base).href : u.href;
  } catch {
    return undefined;
  }
}

interface CoverCandidate {
  url: string;
  info: string;
}

// Every picture on the story page that could be its cover, with what a reader would look at to
// tell: where it came from, its alt text, its size attributes, whether it sits in a link to
// another page, and whether it comes before the page's main heading. Only builds the list.
function coverCandidates(doc: Document, pageUrl: string): CoverCandidate[] {
  const out: CoverCandidate[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined, info: string) => {
    const url = raw ? realImageUrl(raw.trim(), pageUrl) : undefined;
    if (!url || seen.has(url) || /\.svg(\?|$)/i.test(url)) return;
    seen.add(url);
    out.push({ url, info });
  };
  for (const [selector, from] of [
    ['meta[property="og:image"]', "og:image"],
    ['meta[name="twitter:image"]', "twitter:image"],
    ['link[rel="image_src"]', "image_src link"],
    ['[itemprop="image"]', "itemprop image"],
  ] as const) {
    const el = doc.querySelector(selector);
    add(el?.getAttribute("content") ?? el?.getAttribute("href") ?? el?.getAttribute("src"), `from ${from}`);
  }
  const heading = doc.querySelector("h1");
  for (const img of Array.from(doc.querySelectorAll("img")).slice(0, 60)) {
    const srcset = img.getAttribute("srcset")?.split(",").pop()?.trim().split(/\s+/)[0];
    const raw = img.getAttribute("data-src") ?? img.getAttribute("data-lazy-src") ?? img.getAttribute("src") ?? srcset;
    const width = Number(img.getAttribute("width"));
    if (width && width < 60) continue;
    const link = img.closest("a")?.getAttribute("href");
    const before = heading ? !!(img.compareDocumentPosition(heading) & 4) : false; // heading follows the image
    add(
      raw,
      `from <img>, alt "${preview(img.getAttribute("alt") ?? "", 60)}", ${
        width ? `${width}px wide` : "size not stated"
      }, ${link ? `inside a link to ${preview(link, 60)}` : "not in a link"}, ${before ? "before" : "after"} the main heading`
    );
  }
  return out.slice(0, 12);
}

// The AI says which picture is the story's cover, or none.
async function chooseCover(
  provider: AiProvider,
  candidates: CoverCandidate[],
  state: string
): Promise<string | undefined> {
  if (candidates.length === 0) return undefined;
  const options: Record<string, string> = {};
  candidates.forEach((c, i) => (options[`image${i + 1}`] = `${c.url} — ${c.info}`));
  options.none = "None of these is the story's cover";
  const picked = await provider.choose(
    "Which picture is the cover art of this story (the book's cover), not a logo, avatar, banner, advert, icon or the cover of another story?",
    state,
    options
  );
  return candidates[Number(picked.replace("image", "")) - 1]?.url;
}

async function parseToc(provider: AiProvider, storyUrl: string, html: string): Promise<AiToc> {
  const dom = new JSDOM(html, { url: storyUrl });
  const doc = dom.window.document;
  try {
    const guess = pageTitle(doc);
    const author = doc.querySelector('meta[name="author"], meta[property="book:author"]')?.getAttribute("content") ?? undefined;
    const groups = linkGroups(doc, storyUrl);
    if (groups.length === 0) throw new NoChapterListError(t("Could not find a chapter list on {url}", { url: storyUrl }));
    const options: Record<string, string> = {};
    groups.forEach(({ links }, i) => {
      const first = links.slice(0, 3).map((l) => l.title).join(" | ");
      const last = links.slice(-2).map((l) => l.title).join(" | ");
      options[`list${i + 1}`] = `${links.length} links. first: ${first}. last: ${last}`;
    });
    options.none = "None of these is the chapter list of the story";
    const state = `Page title: ${guess}\nURL: ${storyUrl}`;
    const picked = await provider.choose(
      `The page is the home page of a web novel titled "${guess}". Which group of links is the list of the story's chapters (not genres, menus, other stories or comments)?`,
      state,
      options
    );
    const index = Number(picked.replace("list", "")) - 1;
    if (picked === "none" || !groups[index]) throw new NoChapterListError(t("Could not find a chapter list on {url}", { url: storyUrl }));

    const chapters = groups[index].links;
    const titlePiece = await chooseTitlePiece(provider, chapters, state);
    const title = (await chooseTitle(provider, "story", titleCandidates(doc), state)) ?? guess;
    const coverUrl = await chooseCover(provider, coverCandidates(doc, storyUrl), `${state}\nStory: ${title}`);
    // Chapter lists are often newest-first; the reader expects chapter 1 first. Numbers in the
    // titles decide when they are there, otherwise keep the page order.
    const num = (s: string) => Number(s.match(/\d+/)?.[0] ?? NaN);
    const a = num(titleOf(chapters[0], titlePiece));
    const b = num(titleOf(chapters[chapters.length - 1], titlePiece));
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) chapters.reverse();
    return { title, author, coverUrl, chapters, titlePiece };
  } finally {
    dom.window.close();
  }
}

function finalizeToc(toc: AiToc): TocResult {
  return {
    title: toc.title,
    author: toc.author,
    coverUrl: toc.coverUrl,
    chapters: toc.chapters.map((c) => ({ url: c.url, title: titleOf(c, toc.titlePiece) })),
  };
}

export async function parseTocWithAi(provider: AiProvider, storyUrl: string, html: string): Promise<TocResult> {
  return finalizeToc(await parseToc(provider, storyUrl, html));
}

const textLength = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").length;
const flat = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const MAX_DEPTH = 5;
const MIN_PART_CHARS = 20;
// A part worth offering is a region of the page (it has things inside it), not one paragraph
// or one line of the chapter: the prose is made of those, it is never one of them.
const isRegion = (el: Element) => /^(DIV|SECTION|ARTICLE|MAIN|UL|OL|TABLE|FIGURE)$/.test(el.tagName) && el.children.length > 0;

function label(el: Element): string {
  return el.id ? `#${el.id}` : el.className ? `.${String(el.className).split(/\s+/)[0]}` : el.tagName.toLowerCase();
}

// One line the AI reads to judge an element: what it is, how big, how it begins and ends.
function describe(el: Element): string {
  return `${label(el)}, ${textLength(el)} characters, ${el.querySelectorAll("p").length} paragraphs. starts: ${preview(flat(el), 160)} ends: ${preview(flat(el).slice(-160), 160)}`;
}

// What the AI is told about the page, apart from the options.
const LOCKED = "The page asks the reader to log in, subscribe or pay instead of showing the chapter";

export async function extractChapterWithAi(provider: AiProvider, url: string, html: string): Promise<ExtractedChapter> {
  const dom = new JSDOM(html, { url });
  try {
    const doc = dom.window.document;
    const title = pageTitle(doc);
    // Taken before the page chrome is stripped: the heading often sits in a <header>.
    const titleCands = titleCandidates(doc);
    doc.querySelectorAll(NOISE).forEach((el) => el.remove());

    const bodies: { el: Element; chars: number }[] = [];
    for (const el of Array.from(doc.body.querySelectorAll("article, main, section, div"))) {
      const chars = textLength(el);
      if (chars < MIN_BODY_CHARS) continue;
      const child = Array.from(el.children).some((c) => /^(ARTICLE|MAIN|SECTION|DIV)$/.test(c.tagName) && textLength(c) >= chars * 0.9);
      if (!child) bodies.push({ el, chars });
    }
    bodies.sort((a, b) => b.chars - a.chars);
    const top = bodies.slice(0, MAX_CANDIDATES);
    const state = `Page title: ${title}\nURL: ${url}`;
    const locked = () =>
      new LockedContentError(t("This chapter needs a login on the site, which the app does not bypass: {url}", { url }));

    // No block of text at all: the page is a wall or an empty shell. The AI says which.
    if (top.length === 0) {
      const verdict = await provider.choose(
        "This page has almost no text. Why?",
        `${state}\nText on the page: ${preview(flat(doc.body), 400)}`,
        { locked: LOCKED, empty: "The page is empty or failed to load, for no reason the reader can fix" }
      );
      throw verdict === "locked" ? locked() : new Error(t("Could not extract main content from {url}", { url }));
    }

    // Step 1: the region of the page that holds the chapter, or the verdict that it is locked.
    const options: Record<string, string> = {};
    top.forEach(({ el }, i) => (options[`body${i + 1}`] = describe(el)));
    options.locked = LOCKED;
    const picked = await provider.choose(
      "Which element holds the text of the chapter itself (the story prose)? Comments, chapter lists, recommendations, descriptions and site text are not the chapter.",
      state,
      options
    );
    if (picked === "locked") throw locked();
    const first = top[Number(picked.replace("body", "")) - 1]?.el;
    if (!first) throw new Error(t("Could not extract main content from {url}", { url }));
    let chosen: Element = first;

    // Step 2: the region often wraps the chapter together with other things. Show the AI its
    // parts and let it say whether the whole region is the chapter or one part is; repeat
    // inside that part. No size rule decides this.
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const parts: Element[] = Array.from(chosen.children)
        .filter((c) => isRegion(c) && textLength(c) >= MIN_PART_CHARS)
        .slice(0, MAX_CANDIDATES);
      if (parts.length === 0) break;
      // A wrapper whose only part holds all of its text offers no choice: step in without asking.
      if (parts.length === 1 && textLength(parts[0]) >= textLength(chosen) * 0.98) {
        chosen = parts[0];
        continue;
      }
      const partOptions: Record<string, string> = {
        whole: "The whole element is the chapter text, nothing in it has to be left out",
      };
      parts.forEach((part, i) => (partOptions[`part${i + 1}`] = describe(part)));
      const answer = await provider.choose(
        `The chapter text is somewhere in this element (${describe(chosen)}). Is the whole element the chapter, or does only one of its parts hold the chapter text, with the other parts being comments, chapter lists, ads or site text?`,
        state,
        partOptions
      );
      const part: Element | undefined = answer === "whole" ? undefined : parts[Number(answer.replace("part", "")) - 1];
      if (!part) break;
      chosen = part;
    }

    const blocks: ExtractedChapter["blocks"] = [];
    const prose = chosen;
    walkToBlocks(prose, blocks);
    // A body of bare text and <br> has no child elements for walkToBlocks to see.
    if (blocks.length === 0) {
      const lines = prose.innerHTML.split(/<br\s*\/?>|\n+/i);
      for (const line of lines) {
        const text = line.replace(/<[^>]*>/g, "").trim();
        if (text) blocks.push({ type: "paragraph", text });
      }
    }
    // The chapter's title: the AI picks among the page's headings, title tags and the first
    // lines of the text. A first line it picks is the title, not prose, so it leaves the text.
    const starts = blocks
      .slice(0, 2)
      .map((b) => norm((b.text ?? "").replace(/<[^>]*>/g, "")))
      .filter((text) => text && text.length <= 150);
    const chosenTitle = await chooseTitle(
      provider,
      "chapter",
      [...titleCands, ...titleCandidates(doc, starts).filter((c) => c.from === "start of the page text")],
      state
    ).catch(() => undefined);
    if (chosenTitle && starts[0] === chosenTitle && blocks[0]?.type === "paragraph") blocks.shift();
    return { sourceUrl: url, title: chosenTitle ?? title, blocks, titleFromAi: chosenTitle !== undefined };
  } finally {
    dom.window.close();
  }
}

// Plain fetch first, a browser when the page needs scripts to show its content.
async function loadHtml(url: string): Promise<string> {
  try {
    const html = await fetchText(url);
    if (html.length > 2000) return html;
  } catch {
    // fall through to the renderer
  }
  return renderPageHtml(url);
}

const VIEW_ALL_RE = /^(xem tất cả|xem thêm|xem đầy đủ|view all|show all|see all)/i;
const CHAPTER_TAB_RE = /danh sách chương|mục lục|chapter list|chapters|table of contents|toc/i;

// Many story pages keep the chapter list behind a tab or a "show chapters" button that only
// a click mounts. Click the ones whose label names the chapter list, then let it render.
export async function openChapterTabs(page: Page): Promise<void> {
  const linksBefore = await page.locator("a[href]").count();
  const candidates = page.locator('[role="tab"], button, a[href^="#"]');
  const count = Math.min(await candidates.count(), 60);
  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    const text = ((await el.textContent().catch(() => "")) ?? "").trim();
    if (text.length > 40 || !CHAPTER_TAB_RE.test(text)) continue;
    await el.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  // A tab often lists only the first and latest chapters and keeps the rest behind a "view
  // all" button that shows up once the tab has loaded: wait for it rather than look once.
  await page
    .getByRole("button", { name: VIEW_ALL_RE })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  // Whatever it opened loads over the network: wait for links to appear, not for a fixed time.
  await page
    .waitForFunction((n) => document.querySelectorAll("a[href]").length > n + 10, linksBefore, { timeout: 6000 })
    .catch(() => {});
  await page.waitForTimeout(500);
}

const MAX_TOC_PAGES = 300;
const NEXT_PAGE = [
  '[aria-label*="next page" i]',
  '[aria-label*="trang sau" i]',
  'a[rel="next"]',
  'button:has-text("Next")',
  'button:has-text("Trang sau")',
].join(", ");

// A dialog (a "chapters" popup) holds the list and its own pager: read and page that, not the
// page behind it.
function listScope(page: Page) {
  const dialog = page.locator('[role="dialog"]');
  return dialog.first();
}

async function pageAnchors(page: Page): Promise<Link[]> {
  const scope = (await page.locator('[role="dialog"]').count()) ? listScope(page) : page.locator("body");
  const raw = await scope.locator("a[href]").evaluateAll((as) =>
    as.map((a) => {
      // Same split as piecesOf(), which cannot run here.
      const norm = (x: string | null) => (x ?? "").replace(/\s+/g, " ").trim();
      const inline = /^(A|B|STRONG|EM|I|U|S|SMALL|MARK|SUP|SUB|BR|FONT|ABBR|CITE|CODE)$/;
      const out: string[] = [];
      const collect = (node: Element) => {
        let run = "";
        const flush = () => {
          if (norm(run)) out.push(norm(run));
          run = "";
        };
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 3) run += child.textContent ?? "";
          else if (child.nodeType === 1) {
            const el = child as Element;
            if (inline.test(el.tagName) && el.children.length === 0) run += el.textContent ?? "";
            else {
              flush();
              collect(el);
            }
          }
        }
        flush();
      };
      collect(a);
      return {
        url: (a as HTMLAnchorElement).href,
        title: a.textContent ?? "",
        pieces: out.length >= 2 ? out : [],
      };
    })
  );
  return raw
    .map((a) => ({ url: a.url.split("#")[0], title: preview(a.title, 200), pieces: a.pieces }))
    .filter((a) => a.title);
}

// Click "next page" until it is gone, disabled or changes nothing, keeping the links of every
// page. `first` is the HTML of page one: the AI chooses the chapter list there, and the
// links of the later pages are matched against that choice by URL shape.
async function walkTocPages(page: Page, out: { first: string; pages: Link[][] }): Promise<void> {
  const keyOf = async () => (await pageAnchors(page)).map((a) => a.url).join("\n");
  let previous = "";
  for (let i = 0; i < MAX_TOC_PAGES; i++) {
    const anchors = await pageAnchors(page);
    previous = anchors.map((a) => a.url).join("\n");
    if (i === 0) out.first = await page.content();
    out.pages.push(anchors);
    // The button can be missing or disabled for a moment while the page re-renders: only a
    // button that stays that way is the last page.
    let next = page.locator(NEXT_PAGE).first();
    let ready = false;
    for (let look = 0; look < 12 && !ready; look++) {
      const inDialog = (await page.locator('[role="dialog"]').count()) > 0;
      next = (inDialog ? listScope(page) : page).locator(NEXT_PAGE).first();
      ready =
        (await next.count()) > 0 &&
        (await next.isEnabled().catch(() => false)) &&
        (await next.getAttribute("aria-disabled").catch(() => null)) !== "true";
      if (!ready) await page.waitForTimeout(500);
    }
    if (!ready) break;
    // The next page arrives from the network, and a click can land while the previous page
    // is still mounting: wait for the links to change, click again a few times, and only
    // then decide there is nothing more — a slow page must not end the walk early.
    let changed = false;
    for (let click = 0; click < 4 && !changed; click++) {
      await next.click({ timeout: 3000 }).catch(() => {});
      for (let wait = 0; wait < 10 && !changed; wait++) {
        await page.waitForTimeout(500);
        changed = (await keyOf()) !== previous;
      }
    }
    if (!changed) break;
    // The links change while the page is still loading (a skeleton, half a list). Read it
    // only once two looks in a row agree, or a page gets skipped when the next click lands
    // before it finished.
    for (let look = 0; look < 12; look++) {
      const before = await keyOf();
      await page.waitForTimeout(400);
      if (before === (await keyOf()) && before !== "") break;
    }
  }
}

// The same path on the story's own host.
function onStoryHost(url: string, storyUrl: string): string {
  const u = new URL(url);
  u.host = new URL(storyUrl).host;
  u.protocol = new URL(storyUrl).protocol;
  return u.href;
}

// "https://x/truyen/a/chuong-12" -> any path with the same shape and another number. The host
// is left out on purpose: some sites link later pages' chapters on a mirror domain.
function chapterShape(sample: string): RegExp {
  const u = new URL(sample);
  const escaped = u.pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\d+/g, "\\d+")}/?$`);
}

function readingOrder(chapters: Link[]): Link[] {
  const n = (c: Link) => Number(c.url.match(/(\d+)\/?$/)?.[1] ?? NaN);
  return chapters.every((c) => Number.isFinite(n(c))) ? [...chapters].sort((a, b) => n(a) - n(b)) : chapters;
}

// Chapter lists paged by URL (?page=2): the first page links to the others. Fetch them in turn
// until one adds no chapter of the shape the AI picked.
const PAGE_PARAM_RE = /[?&](page|p|trang)=(\d+)/i;

async function withUrlPages(toc: AiToc, storyUrl: string, html: string): Promise<AiToc> {
  const dom = new JSDOM(html, { url: storyUrl });
  let param: string | undefined;
  try {
    const story = new URL(storyUrl);
    for (const a of Array.from(dom.window.document.querySelectorAll("a[href]"))) {
      const href = new URL(a.getAttribute("href") as string, storyUrl);
      const m = PAGE_PARAM_RE.exec(href.search);
      if (m && href.hostname === story.hostname && href.pathname.replace(/\/$/, "") === story.pathname.replace(/\/$/, "")) {
        param = m[1];
        break;
      }
    }
  } finally {
    dom.window.close();
  }
  if (!param) return toc;

  const shape = chapterShape(toc.chapters[0].url);
  const byUrl = new Map(toc.chapters.map((c) => [c.url, c]));
  // Chapter links of one page, on the story's host. Counts how many were new.
  const collect = (pageHtml: string, pageUrl: string): number => {
    const pageDom = new JSDOM(pageHtml, { url: pageUrl });
    let added = 0;
    try {
      for (const a of Array.from(pageDom.window.document.querySelectorAll("a[href]"))) {
        let url: string;
        try {
          url = onStoryHost(new URL(a.getAttribute("href") as string, pageUrl).href.split("#")[0], storyUrl);
        } catch {
          continue;
        }
        const title = preview(a.textContent ?? "", 200);
        if (title && shape.test(new URL(url).pathname) && !byUrl.has(url)) {
          byUrl.set(url, { url, title, pieces: piecesOf(a) });
          added++;
        }
      }
    } finally {
      pageDom.window.close();
    }
    return added;
  };
  // Page one too: a chapter linked there on a mirror domain was dropped as "another site".
  collect(html, storyUrl);
  for (let n = 2; n <= MAX_TOC_PAGES; n++) {
    const pageUrl = new URL(storyUrl);
    pageUrl.searchParams.set(param, String(n));
    let pageHtml: string;
    try {
      pageHtml = await fetchText(pageUrl.href);
    } catch {
      break;
    }
    if (collect(pageHtml, pageUrl.href) === 0) break;
  }
  return { ...toc, chapters: readingOrder([...byUrl.values()]) };
}

// Used for every story URL outside the allowlist, when AI crawling is on.
export function createAiTocAdapter(): TocAdapter {
  return {
    domains: [],
    normalizeStoryUrl: (url) => url,
    async fetchToc(storyUrl) {
      const provider = requireProvider();
      try {
        const html = await loadHtml(storyUrl);
        return finalizeToc(await withUrlPages(await parseToc(provider, storyUrl, html), storyUrl, html));
      } catch (err) {
        if (!(err instanceof NoChapterListError)) throw err;
      }
      // A click can land before the page's scripts are attached and do nothing, so the list
      // never opens: load the page again a couple of times before giving up.
      let toc: AiToc | undefined;
      let walked = { first: "", pages: [] as Link[][] };
      for (let attempt = 1; !toc; attempt++) {
        walked = { first: "", pages: [] };
        const current = walked;
        const rendered = await renderPageHtml(storyUrl, {
          afterOpen: async (page) => {
            await openChapterTabs(page);
            await walkTocPages(page, current);
          },
        });
        try {
          toc = await parseToc(provider, storyUrl, walked.first || rendered);
        } catch (err) {
          if (!(err instanceof NoChapterListError) || attempt >= 3) throw err;
        }
      }
      // Later pages: every link shaped like the chapters the AI picked on the first one.
      const shape = chapterShape(toc.chapters[0].url);
      const byUrl = new Map(toc.chapters.map((c) => [c.url, c]));
      for (const anchor of walked.pages.flat()) {
        const url = onStoryHost(anchor.url, storyUrl);
        if (shape.test(new URL(url).pathname) && !byUrl.has(url)) byUrl.set(url, { ...anchor, url });
      }
      return finalizeToc({ ...toc, chapters: readingOrder([...byUrl.values()]) });
    },
  };
}

export async function fetchChapterWithAi(url: string): Promise<ExtractedChapter> {
  const provider = requireProvider();
  try {
    return await extractChapterWithAi(provider, url, await loadHtml(url));
  } catch (err) {
    if (err instanceof AiNotConfiguredError || err instanceof LockedContentError) throw err;
    // The plain page may be an empty shell that scripts fill in: read what a browser shows.
    return extractChapterWithAi(provider, url, await renderPageHtml(url));
  }
}
