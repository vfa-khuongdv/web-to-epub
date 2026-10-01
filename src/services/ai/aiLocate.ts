/**
 * Crawling a site nobody wrote an adapter for. The page is parsed here; the AI only chooses
 * among candidates the code lists (which group of links is the chapter list, which element is
 * the chapter body, which line is the title…), and the text itself always comes from the DOM —
 * a model cannot invent or drop a sentence.
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
const MIN_BODY_CHARS = 200;
// Never content: code and templates. Navigation, headers, forms and the like stay in; the AI
// decides what is the chapter.
const NOISE = "script, style, noscript, template";

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
  // Found inside the list itself (see listContainer), not as a button elsewhere on the page
  // ("read from the start", "latest chapter"): its title is the chapter's name.
  inList?: boolean;
}
type TitlePiece = number | "whole";
interface AiToc extends Omit<TocResult, "chapters"> {
  chapters: Link[];
  titlePiece: TitlePiece;
  // The address shape of the chapters (see urlShape), used to find them on later pages.
  shape: string;
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

// The shape of a link's address, with the parts that change from one chapter to the next blanked
// out: numbers, and long ids made of letters and digits. "/truyen/a/chuong-12/" and
// "/truyen/a/chuong-13/" share "/truyen/a/chuong-#"; "/doc-truyen/a/6ab0767331…" and
// "/doc-truyen/a/6ab076c331…" share "/doc-truyen/a/#". The chapters of one story share a shape,
// while genres, tags, menus and other stories — their chapters included, whose path names
// another story — have shapes of their own. The host is left out: some sites link part of the
// list on a mirror domain.
export function urlShape(url: string): string {
  const u = new URL(url);
  const path = u.pathname
    .split("/")
    .map((seg) => (/\d/.test(seg) && /^[0-9a-z]{12,}$/i.test(seg) ? "#" : seg.replace(/\d+/g, "#")))
    .join("/")
    .replace(/\/$/, "");
  const query = [...u.searchParams.keys()]
    .sort()
    .map((key) => `${key}=#`)
    .join("&");
  return query ? `${path}?${query}` : path;
}

interface Cluster {
  shape: string;
  links: Link[];
}

// The element holding most of a cluster's links, as deep as possible: the list itself rather
// than the page around it. A chapter linked twice ("read from the start" and its row in the
// list) takes its title from the row, which sits in here.
function listContainer(anchors: Element[]): Element | undefined {
  const counts = new Map<Element, number>();
  for (const a of anchors) for (let el = a.parentElement; el; el = el.parentElement) counts.set(el, (counts.get(el) ?? 0) + 1);
  const need = Math.max(2, Math.ceil(anchors.length * 0.6));
  let best: Element | undefined;
  let bestDepth = -1;
  for (const [el, count] of counts) {
    if (count < need) continue;
    let depth = 0;
    for (let up = el.parentElement; up; up = up.parentElement) depth++;
    if (depth > bestDepth) {
      best = el;
      bestDepth = depth;
    }
  }
  return best;
}

// Every link on the page, grouped by address shape: the candidates for "the chapter list". One
// link per chapter address, on the story's own host, in the order of the list they sit in.
function linkClusters(doc: Document, storyUrl: string, limit = MAX_CANDIDATES): Cluster[] {
  const story = new URL(storyUrl);
  story.hash = "";
  const byShape = new Map<string, { a: Element; url: string }[]>();
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    let u: URL;
    try {
      // Against the document's own address: a later page of the list resolves its links from there.
      u = new URL(a.getAttribute("href") as string, doc.baseURI);
    } catch {
      continue;
    }
    u.hash = "";
    if (!/^https?:$/.test(u.protocol) || !norm(a.textContent) || u.href === story.href) continue;
    const shape = urlShape(u.href);
    const list = byShape.get(shape) ?? [];
    list.push({ a, url: onStoryHost(u.href, storyUrl) });
    byShape.set(shape, list);
  }
  const clusters: Cluster[] = [];
  for (const [shape, found] of byShape) {
    const box = listContainer(found.map((f) => f.a));
    const inside = box ? found.filter((f) => box.contains(f.a)) : found;
    const outside = box ? found.filter((f) => !box.contains(f.a)) : [];
    const seen = new Set<string>();
    const links: Link[] = [];
    for (const { a, url } of [...inside, ...outside]) {
      if (seen.has(url)) continue;
      seen.add(url);
      links.push({ url, title: preview(a.textContent ?? "", 200), pieces: piecesOf(a), inList: box ? box.contains(a) : false });
    }
    clusters.push({ shape, links });
  }
  return clusters.sort((a, b) => b.links.length - a.links.length).slice(0, limit);
}

// The chapter links of one page of the list: the links with the chapters' address shape, each
// titled from the list it sits in (see listContainer).
function chapterLinksIn(html: string, pageUrl: string, storyUrl: string, shape: string): Link[] {
  const dom = new JSDOM(html, { url: pageUrl });
  try {
    return linkClusters(dom.window.document, storyUrl, Infinity).find((c) => c.shape === shape)?.links ?? [];
  } finally {
    dom.window.close();
  }
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
    const link = img.closest("a")?.getAttribute("href");
    const before = heading ? !!(img.compareDocumentPosition(heading) & 4) : false; // heading follows the image
    add(
      raw,
      `from <img>, alt "${preview(img.getAttribute("alt") ?? "", 60)}", ${
        width ? `${width}px wide` : "size not stated"
      }, ${link ? `inside a link to ${preview(link, 60)}` : "not in a link"}, ${before ? "before" : "after"} the main heading`
    );
  }
  return out.slice(0, 20);
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
    const clusters = linkClusters(doc, storyUrl);
    if (clusters.length === 0) throw new NoChapterListError(t("Could not find a chapter list on {url}", { url: storyUrl }));
    const options: Record<string, string> = {};
    clusters.forEach(({ shape, links }, i) => {
      const first = links.slice(0, 3).map((l) => l.title).join(" | ");
      const last = links.slice(-2).map((l) => l.title).join(" | ");
      options[`list${i + 1}`] = `${links.length} links to addresses like ${shape} — first: ${first}. last: ${last}`;
    });
    options.none = "None of these is the chapter list of the story";
    const state = `Page title: ${guess}\nURL: ${storyUrl}`;
    const picked = await provider.choose(
      `The page is the home page of a web novel titled "${guess}". The links on it are grouped by the shape of their address. Which group is the list of this story's chapters (not genres, tags, menus, other stories or their chapters)?`,
      state,
      options
    );
    const cluster = clusters[Number(picked.replace("list", "")) - 1];
    if (picked === "none" || !cluster) throw new NoChapterListError(t("Could not find a chapter list on {url}", { url: storyUrl }));
    const chapters = cluster.links;
    const titlePiece = await chooseTitlePiece(provider, chapters, state);
    const title = (await chooseTitle(provider, "story", titleCandidates(doc), state)) ?? guess;
    const coverUrl = await chooseCover(provider, coverCandidates(doc, storyUrl), `${state}\nStory: ${title}`);
    // Chapter lists are often newest-first; the reader expects chapter 1 first. Numbers in the
    // titles decide when they are there, otherwise keep the page order.
    const num = (s: string) => Number(s.match(/\d+/)?.[0] ?? NaN);
    const a = num(titleOf(chapters[0], titlePiece));
    const b = num(titleOf(chapters[chapters.length - 1], titlePiece));
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) chapters.reverse();
    return { title, author, coverUrl, chapters: readingOrder(chapters), titlePiece, shape: cluster.shape };
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
// or one line of the chapter: the prose is made of those, it is never one of them. Regions are
// found by what they are not — text-level tags — so a site's own container elements
// (<el-tab-panels>, <app-root>…) count too.
const TEXT_LEVEL = /^(P|H[1-6]|LI|SPAN|A|B|STRONG|EM|I|U|S|SMALL|BR|IMG|BLOCKQUOTE|PRE|TD|TH|TR|FIGCAPTION|LABEL|BUTTON|SVG)$/;
const isRegion = (el: Element) => !TEXT_LEVEL.test(el.tagName.toUpperCase()) && el.children.length > 0;

function label(el: Element): string {
  return el.id ? `#${el.id}` : el.className ? `.${String(el.className).split(/\s+/)[0]}` : el.tagName.toLowerCase();
}

// One line the AI reads to judge an element: what it is, how big, how it begins and ends.
function describe(el: Element): string {
  return `${label(el)}, ${textLength(el)} characters, ${el.querySelectorAll("p").length} paragraphs. starts: ${preview(flat(el), 160)} ends: ${preview(flat(el).slice(-160), 160)}`;
}

// What the AI is told about the page, apart from the options.
const LOCKED = "The page asks the reader to log in, subscribe or pay instead of showing the chapter";

// Parts of an element that are blocks of their own with text in them (not inline styling, not
// icons): what could be "the story text" next to a counter or a button.
const blockParts = (el: Element) =>
  Array.from(el.children).filter((c) => !INLINE_TAGS.test(c.tagName.toUpperCase()) && textLength(c) > 0);

// Narrow every paragraph (child) of the chapter region to the part of it that is story text.
// The AI looks at the first paragraph that has parts and walks down it, one choice per level;
// the same path of choices is then followed in every paragraph. Returns an element to read the
// blocks from: the region itself when its paragraphs are already plain text.
async function keepStoryText(provider: AiProvider, region: Element, state: string): Promise<Element> {
  const units = blockParts(region);
  const sample = units.find((u) => blockParts(u).length > 0);
  if (!sample) return region;

  const path: number[] = [];
  let node = sample;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const parts = blockParts(node).slice(0, MAX_CANDIDATES);
    if (parts.length === 0) break;
    // One part holding all the text offers no choice: step in without asking.
    if (parts.length === 1 && textLength(parts[0]) >= textLength(node) * 0.98) {
      path.push(0);
      node = parts[0];
      continue;
    }
    const options: Record<string, string> = {
      whole: "All of it is story text, nothing in it has to be left out",
    };
    parts.forEach((part, i) => (options[`part${i + 1}`] = describe(part)));
    const answer = await provider.choose(
      `This is one paragraph of a chapter (${describe(node)}). Besides the story text it may hold buttons, counters, share or comment widgets. Which part is the story text itself?`,
      state,
      options
    );
    const part = answer === "whole" ? undefined : parts[Number(answer.replace("part", "")) - 1];
    if (!part) break;
    path.push(parts.indexOf(part));
    node = part;
  }
  if (path.length === 0) return region;

  const holder = region.ownerDocument.createElement("div");
  for (const unit of units) {
    let current: Element | undefined = unit;
    for (const index of path) current = current && blockParts(current)[index];
    holder.appendChild(current ?? unit);
  }
  return holder;
}

// How many paragraphs at each end of a chapter the AI is asked about.
const MAX_EDGE_TRIM = 3;
const blockText = (b: ExtractedChapter["blocks"][number]) => norm((b.text ?? "").replace(/<[^>]*>/g, ""));

// Sites put their own lines inside the chapter text — "read the latest chapters at…", "copied
// elsewhere it will be incomplete", a link to the next chapter — almost always at its start or
// end. Ask the AI about the paragraphs at each end, one at a time, walking inwards and stopping
// at the first one it calls story text: a wrong answer can only cost an edge paragraph, never
// one from the middle of the chapter.
async function trimSiteLines(provider: AiProvider, blocks: ExtractedChapter["blocks"], state: string): Promise<void> {
  const ask = async (block: ExtractedChapter["blocks"][number], where: string, neighbour?: ExtractedChapter["blocks"][number]) => {
    const answer = await provider.choose(
      `This paragraph is at the ${where} of a chapter of a web novel: "${preview(blockText(block), 300)}"${
        neighbour ? ` (the paragraph next to it: "${preview(blockText(neighbour), 120)}")` : ""
      }. Is it part of the story, or a line the site added?`,
      state,
      {
        story: "Part of the story: narration, dialogue, a heading or a note by the author",
        site: "Added by the site: a notice, an advert, where to read more, a request to share or rate, navigation",
      }
    );
    return answer === "site";
  };
  for (let k = 0; k < MAX_EDGE_TRIM && blocks.length > 1; k++) {
    if (blocks[0].type !== "paragraph" || !(await ask(blocks[0], "start", blocks[1]))) break;
    blocks.shift();
  }
  for (let k = 0; k < MAX_EDGE_TRIM && blocks.length > 1; k++) {
    const last = blocks[blocks.length - 1];
    if (last.type !== "paragraph" || !(await ask(last, "end", blocks[blocks.length - 2]))) break;
    blocks.pop();
  }
}

export async function extractChapterWithAi(provider: AiProvider, url: string, html: string): Promise<ExtractedChapter> {
  const dom = new JSDOM(html, { url });
  try {
    const doc = dom.window.document;
    const title = pageTitle(doc);
    const titleCands = titleCandidates(doc);
    doc.querySelectorAll(NOISE).forEach((el) => el.remove());

    const bodies: { el: Element; chars: number }[] = [];
    for (const el of Array.from(doc.body.querySelectorAll("*")).filter(isRegion)) {
      const chars = textLength(el);
      if (chars < MIN_BODY_CHARS) continue;
      const child = Array.from(el.children).some((c) => isRegion(c) && textLength(c) >= chars * 0.9);
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

    // Step 3: each paragraph of the chapter may be built of the story text plus buttons, counters
    // or comment widgets. Show the AI one paragraph's parts, let it say which is the story text,
    // and take the same part of every paragraph.
    const prose = await keepStoryText(provider, chosen, state);

    const blocks: ExtractedChapter["blocks"] = [];
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
    await trimSiteLines(provider, blocks, state);
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

const MAX_TOC_PAGES = 300;
const MAX_CONTROLS = 40;

// A button, tab or link the reader can press on the story page without leaving it. The code only
// lists them; the AI says which one reveals the chapter list or turns to its next page, so no
// label, class or attribute is matched here.
interface Control {
  idx: number;
  tag: string;
  role: string;
  text: string;
  label: string;
  title: string;
  query: string;
  disabled: boolean;
  selected: boolean;
  // A link whose address is the one the page is at: the page of a pager the reader is on.
  here: boolean;
  inDialog: boolean;
}

// Self-contained on purpose: it also runs inside the browser (sent as source with toString), so
// it may use nothing from this module. A link counts as a control only when it stays on this
// page (the same path, or just a fragment): paging and tabs do, links to other pages do not.
function collectControls(doc: Document, pagePath: string, checkVisible: boolean): Control[] {
  const norm = (x: string | null) => (x ?? "").replace(/\s+/g, " ").trim();
  const here = pagePath.replace(/\/$/, "");
  const out: Control[] = [];
  const els = Array.from(doc.querySelectorAll('button, [role="button"], [role="tab"], summary, a[href]'));
  for (const el of els) {
    if (out.length >= 60) break;
    const tag = el.tagName.toLowerCase();
    let query = "";
    let sameAddress = false;
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      let url: URL;
      try {
        url = new URL(href, doc.baseURI);
      } catch {
        continue;
      }
      if (!href.startsWith("#") && url.pathname.replace(/\/$/, "") !== here) continue;
      query = url.search;
      sameAddress = url.href.split("#")[0] === doc.URL.split("#")[0];
    }
    if (checkVisible && (el as HTMLElement).getClientRects().length === 0) continue;
    const text = norm(el.textContent).slice(0, 40);
    const label = norm(el.getAttribute("aria-label"));
    const title = norm(el.getAttribute("title"));
    if (!text && !label && !title) continue;
    el.setAttribute("data-ai-ctl", String(out.length));
    out.push({
      idx: out.length,
      tag,
      role: el.getAttribute("role") ?? "",
      text,
      label,
      title,
      query,
      disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true",
      selected:
        el.getAttribute("aria-selected") === "true" ||
        el.getAttribute("aria-expanded") === "true" ||
        (el.getAttribute("aria-current") ?? "false") !== "false",
      here: sameAddress,
      inDialog: !!el.closest('[role="dialog"], dialog'),
    });
  }
  return out;
}

const describeControl = (c: Control) =>
  `${c.tag}${c.role ? ` [${c.role}]` : ""} "${c.text}"${c.label ? ` aria-label="${c.label}"` : ""}${
    c.title ? ` title="${c.title}"` : ""
  }${c.query ? ` link ${c.query}` : ""}${c.disabled ? " (disabled)" : ""}${c.selected ? " (open/selected)" : ""}${c.here ? " (this is the page you are on now)" : ""}${
    c.inDialog ? " (in a popup)" : ""
  }`;

// The same control seen again after the page changed (its index is not stable, its words are).
const sameControl = (a: Control, b: Control) =>
  a.tag === b.tag && a.role === b.role && a.text === b.text && a.label === b.label && a.title === b.title;

async function controlsOnPage(page: Page): Promise<Control[]> {
  const path = new URL(page.url()).pathname;
  return (await page.evaluate(`(${collectControls.toString()})(document, ${JSON.stringify(path)}, true)`)) as Control[];
}

// `none` is the answer for "no control"; leave it out to make the AI pick one.
async function chooseControl(
  provider: AiProvider,
  question: string,
  controls: Control[],
  state: string,
  none?: string
): Promise<Control | undefined> {
  const shown = controls.slice(0, MAX_CONTROLS);
  if (shown.length === 0) return undefined;
  const options: Record<string, string> = {};
  shown.forEach((c, i) => (options[`ctl${i + 1}`] = describeControl(c)));
  if (none) options.none = none;
  const picked = await provider.choose(question, state, options);
  return shown[Number(picked.replace("ctl", "")) - 1];
}

// "Is there more of the chapter list, and where?" as two plain questions rather than one that
// asks for a judgement and a pick at once: first whether the page shows every chapter (with the
// facts gathered so far and the controls on the page to judge by), then — only if it does not —
// which control leads to the rest, with no "none" to fall back on.
async function askMoreControl(provider: AiProvider, controls: Control[], facts: string): Promise<Control | undefined> {
  if (controls.length === 0) return undefined;
  const state = `${facts}\nControls on the page: ${controls.slice(0, MAX_CONTROLS).map(describeControl).join("; ")}`;
  const verdict = await provider.choose("Does this page show every chapter of the story, or only part of them?", state, {
    part: "Only part: more chapters are behind a tab, a pager, a show-all or a load-more button",
    all: "All of them: the list on the page is the whole story",
  });
  if (verdict !== "part") return undefined;
  return chooseControl(provider, "Which control leads to more chapters of this story's list?", controls, state);
}

async function pageAnchors(page: Page): Promise<Link[]> {
  const raw = await page.locator("body a[href]").evaluateAll((as) =>
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

const linkKey = (links: Link[]) => links.map((l) => l.url).join("\n");

function onScreen(links: Link[]): string {
  const first = links.slice(0, 4).map((l) => l.title).join(" | ");
  const last = links.slice(-3).map((l) => l.title).join(" | ");
  return `Links on screen: ${links.length}. first: ${first}. last: ${last}`;
}

// Press what the AI says opens the chapter list, one control at a time, looking at the page
// between presses. A tab, a "show all" button or a "more" button are all just controls to it.
async function revealList(provider: AiProvider, page: Page, state: string): Promise<void> {
  const used: Control[] = [];
  for (let step = 0; step < 4; step++) {
    const controls = (await controlsOnPage(page)).filter((c) => !c.disabled && !used.some((u) => sameControl(u, c)));
    const links = await pageAnchors(page);
    const chosen = await chooseControl(
      provider,
      "The goal is to get the story's full list of chapters on screen. Which control should be pressed next — a tab or button that opens the contents, or one that shows all the chapters or more of them? Answer none when the whole chapter list is already on screen or no control would show it.",
      controls,
      `${state}\n${onScreen(links)}`,
      "Nothing to press: the chapter list is already on screen, or no control would show it"
    );
    if (!chosen) return;
    used.push(chosen);
    const before = linkKey(links);
    await page.locator(`[data-ai-ctl="${chosen.idx}"]`).first().click({ timeout: 3000 }).catch(() => {});
    // What it opens loads over the network: wait for the links to change, not for a fixed time.
    for (let wait = 0; wait < 12; wait++) {
      await page.waitForTimeout(500);
      if (linkKey(await pageAnchors(page)) !== before) break;
    }
    await page.waitForTimeout(500);
  }
}

// Page through the chapter list. The AI says which control turns the page; after that the same
// control (found again by its words) is pressed until it is gone or does nothing, and the AI is
// asked again only when it cannot be found — a numbered pager changes its words every page.
async function walkTocPages(
  provider: AiProvider,
  page: Page,
  state: string,
  out: { first: string; pages: Link[][]; snaps: { html: string; url: string }[] },
  // The address shape of the chapters, when the plain page already told it: the AI is then told
  // how many chapters were gathered and the addresses they run between.
  shape?: string
): Promise<void> {
  let remembered: Control | undefined;
  const gathered = new Map<string, Link>();
  for (let i = 0; i < MAX_TOC_PAGES; i++) {
    const anchors = await pageAnchors(page);
    const before = linkKey(anchors);
    const html = await page.content();
    if (i === 0) out.first = html;
    out.pages.push(anchors);
    out.snaps.push({ html, url: page.url() });
    if (shape) for (const a of anchors) if (urlShape(a.url) === shape) gathered.set(a.url, a);

    // First the control pressed last time, found again by its words; if that does nothing (a
    // numbered pager keeps the number of the page it is already on), or it cannot be found, the
    // AI is asked again. Two tries, then this was the last page.
    let changed = false;
    let done = false;
    for (let attempt = 0; attempt < 2 && !changed && !done; attempt++) {
      let next: Control | undefined;
      if (attempt === 0 && remembered) {
        // The control may be missing or disabled for a moment while the page re-renders: only
        // one that stays that way is gone.
        for (let look = 0; look < 4 && !next; look++) {
          const controls = await controlsOnPage(page);
          const again = controls.find((c) => sameControl(c, remembered as Control));
          if (again && !again.disabled) next = again;
          else if (!again) break;
          else await page.waitForTimeout(1500);
        }
      }
      if (!next) {
        const sofar = readingOrder([...gathered.values()]);
        const facts = sofar.length
          ? `Chapters gathered so far: ${sofar.length}, from ${pathOf(sofar[0].url)} to ${pathOf(sofar[sofar.length - 1].url)}`
          : onScreen(anchors);
        // The address the browser is at now says which page of a numbered pager this is.
        next = await askMoreControl(provider, await controlsOnPage(page), `${state}\nAddress now: ${page.url()}\n${facts}`);
        if (!next || next.disabled) {
          done = true;
          break;
        }
        remembered = next;
      }

      // The next page arrives from the network, and a press can land while the previous page is
      // still mounting: wait for the links to change and press again a few times before deciding
      // it did nothing.
      for (let press = 0; press < 3 && !changed; press++) {
        await page.locator(`[data-ai-ctl="${next.idx}"]`).first().click({ timeout: 3000 }).catch(() => {});
        for (let wait = 0; wait < 10 && !changed; wait++) {
          await page.waitForTimeout(500);
          changed = linkKey(await pageAnchors(page)) !== before;
        }
      }
    }
    if (!changed) break;
    // The links change while the page is still loading (a skeleton, half a list). Read it only
    // once two looks in a row agree, or a page gets skipped when the next press lands early.
    for (let look = 0; look < 12; look++) {
      const seen = linkKey(await pageAnchors(page));
      await page.waitForTimeout(400);
      if (seen === linkKey(await pageAnchors(page)) && seen !== "") break;
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

// The number in an address: the last run of digits outside long ids (the same ids urlShape blanks
// out). "/truyen/a/chuong-12.html" → 12, "/a.1147/trang-3" → 3, "/doc/a/6ab0767…" → NaN.
function addressNumber(url: string): number {
  const u = new URL(url);
  let last = NaN;
  for (const seg of [...u.pathname.split("/"), ...u.searchParams.values()]) {
    if (/\d/.test(seg) && /^[0-9a-z]{12,}$/i.test(seg)) continue;
    const runs = seg.match(/\d+/g);
    if (runs) last = Number(runs[runs.length - 1]);
  }
  return last;
}

// Chapters in reading order: by the number in their address when every one has its own,
// otherwise in the order they were found. "Its own" matters: in "/doc/hen-duyen-1/<id>" every
// chapter carries the story's "1", which says nothing about order.
function readingOrder(chapters: Link[]): Link[] {
  const nums = chapters.map((c) => addressNumber(c.url));
  const usable = nums.every(Number.isFinite) && new Set(nums).size === nums.length;
  if (!usable) return chapters;
  return chapters
    .map((c, i) => ({ c, n: nums[i] }))
    .sort((a, b) => a.n - b.n)
    .map(({ c }) => c);
}

const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

// What the AI is told about a chapter list read so far: how many, the first and last titles,
// and the addresses they run between — "2 chapters, /chuong-1 to /chuong-1281" says plainly
// that most of the list is somewhere else.
function listSoFar(toc: AiToc): string {
  const first = toc.chapters.slice(0, 3).map((c) => titleOf(c, toc.titlePiece)).join(" | ");
  const last = toc.chapters.slice(-2).map((c) => titleOf(c, toc.titlePiece)).join(" | ");
  return `Chapters read from the page: ${toc.chapters.length}, from ${pathOf(toc.chapters[0].url)} to ${pathOf(
    toc.chapters[toc.chapters.length - 1].url
  )}. first: ${first}. last: ${last}`;
}

// Where the rest of a chapter list is: behind a control pressed in the browser (a tab, a
// show-all button), or on further pages reached through a group of links (a pager) — which is
// followed with plain requests.
type More = { control: Control } | { pager: string };

// After reading the list from the plain page: is that the whole list, and if not, which control
// or which group of links leads to the rest? Pagers are often plain links to other addresses
// ("/a.1147/trang-2"), so the other link groups on the page are offered next to the controls.
async function moreChapters(provider: AiProvider, storyUrl: string, html: string, toc: AiToc): Promise<More | undefined> {
  const dom = new JSDOM(html, { url: storyUrl });
  try {
    const doc = dom.window.document;
    const controls = collectControls(doc, new URL(storyUrl).pathname, false).slice(0, MAX_CONTROLS);
    const groups = linkClusters(doc, storyUrl).filter((c) => c.shape !== toc.shape);
    if (controls.length === 0 && groups.length === 0) return undefined;
    const options: Record<string, string> = {};
    controls.forEach((c, i) => (options[`ctl${i + 1}`] = describeControl(c)));
    groups.forEach((g, i) => {
      const titles = g.links.slice(0, 5).map((l) => l.title).join(" | ");
      options[`links${i + 1}`] = `a group of ${g.links.length} links to other pages: ${titles} (addresses like ${g.shape})`;
    });
    const state = `URL: ${storyUrl}\n${listSoFar(toc)}\nOn the page: ${Object.values(options).join("; ")}`;
    // Two plain questions rather than one asking for a judgement and a pick at once.
    const verdict = await provider.choose("Does this page show every chapter of the story, or only part of them?", state, {
      part: "Only part: more chapters are behind a tab, a pager, a show-all or a load-more button",
      all: "All of them: the list on the page is the whole story",
    });
    if (verdict !== "part") return undefined;
    const picked = await provider.choose(
      "Which of these leads to more chapters of this story's list — a tab, a button, or a group of page links?",
      state,
      options
    );
    if (picked.startsWith("ctl")) {
      const control = controls[Number(picked.slice(3)) - 1];
      return control ? { control } : undefined;
    }
    const group = groups[Number(picked.slice(5)) - 1];
    return group ? { pager: group.shape } : undefined;
  } finally {
    dom.window.close();
  }
}

// Add the chapters found on further pages to a list. `preferNew`: the further pages' titles win
// for chapters already listed — when the first list was only a couple of buttons ("read from
// the start", "latest chapter"), the full list names them properly.
function mergeChapters(base: AiToc, pages: Link[][], preferNew: boolean): AiToc {
  const byUrl = new Map(base.chapters.map((c) => [c.url, c]));
  for (const links of pages) {
    for (const link of links) {
      const known = byUrl.get(link.url);
      // A title taken from inside a list replaces one taken from a button, never the reverse.
      if (!known || (link.inList && (!known.inList || preferNew))) byUrl.set(link.url, link);
    }
  }
  return { ...base, chapters: readingOrder([...byUrl.values()]) };
}

// Follow a pager made of links: every page whose address has the pager's shape, as each page
// reveals more of them (a pager shows a window of page numbers). Plain requests, a browser only
// for a page that refuses them. Pages are read in the order of their number.
async function followPager(storyUrl: string, firstHtml: string, pagerShape: string, base: AiToc): Promise<AiToc> {
  const visited = new Set<string>([new URL(storyUrl).href]);
  const queue: string[] = [];
  const enqueue = (html: string, pageUrl: string) => {
    const dom = new JSDOM(html, { url: pageUrl });
    try {
      for (const a of Array.from(dom.window.document.querySelectorAll("a[href]"))) {
        let u: URL;
        try {
          u = new URL(a.getAttribute("href") as string, pageUrl);
        } catch {
          continue;
        }
        u.hash = "";
        if (urlShape(u.href) === pagerShape && !visited.has(u.href) && !queue.includes(u.href)) queue.push(u.href);
      }
    } finally {
      dom.window.close();
    }
  };
  enqueue(firstHtml, storyUrl);
  const pages: { no: number; links: Link[] }[] = [];
  const known = new Set(base.chapters.map((c) => c.url));
  // A page of a pager brings chapters the others did not. When the first page followed brings
  // none, the group was not the pager (genre links, say); and two pages in a row with nothing new
  // mean the list is done. Either way, stop instead of loading every page the group links to.
  let barren = 0;
  while (queue.length > 0 && visited.size <= MAX_TOC_PAGES) {
    const url = queue.shift() as string;
    if (visited.has(url)) continue;
    visited.add(url);
    let html: string;
    try {
      html = await loadHtml(url);
    } catch {
      continue;
    }
    const links = chapterLinksIn(html, url, storyUrl, base.shape);
    const fresh = links.filter((l) => !known.has(l.url));
    fresh.forEach((l) => known.add(l.url));
    if (fresh.length === 0) {
      barren++;
      if (pages.length === 0 || barren >= 2) break;
      continue;
    }
    barren = 0;
    pages.push({ no: addressNumber(url), links });
    enqueue(html, url);
  }
  pages.sort((a, b) => (Number.isFinite(a.no) ? a.no : 0) - (Number.isFinite(b.no) ? b.no : 0));
  return mergeChapters(base, pages.map((p) => p.links), false);
}

// Press, in the browser, a control the AI picked on the plain page (found again by its words),
// and wait for what it brings to load. False when the page has no such control.
async function pressControl(page: Page, wanted: Control): Promise<boolean> {
  const target = (await controlsOnPage(page)).find((c) => sameControl(c, wanted));
  if (!target) return false;
  const before = linkKey(await pageAnchors(page));
  await page.locator(`[data-ai-ctl="${target.idx}"]`).first().click({ timeout: 3000 }).catch(() => {});
  for (let wait = 0; wait < 12; wait++) {
    await page.waitForTimeout(500);
    if (linkKey(await pageAnchors(page)) !== before) break;
  }
  await page.waitForTimeout(500);
  return true;
}

// Used for every story URL outside the allowlist, when AI crawling is on.
export function createAiTocAdapter(): TocAdapter {
  return {
    domains: [],
    normalizeStoryUrl: (url) => url,
    async fetchToc(storyUrl) {
      const provider = requireProvider();
      const state = `URL: ${storyUrl}`;
      // The plain page first. When it shows a list, the AI also says whether a control on it leads
      // to the rest — and that control is what gets pressed in the browser, rather than having
      // the AI look for a way to a list that is already on screen.
      let plain: AiToc | undefined;
      let lead: Control | undefined;
      try {
        const html = await loadHtml(storyUrl);
        plain = await parseToc(provider, storyUrl, html);
        const more = await moreChapters(provider, storyUrl, html, plain);
        if (!more) return finalizeToc(plain);
        // A pager of links needs no browser: its pages are fetched like the first one.
        if ("pager" in more) return finalizeToc(await followPager(storyUrl, html, more.pager, plain));
        lead = more.control;
      } catch (err) {
        if (!(err instanceof NoChapterListError)) throw err;
      }

      // The list is hidden or paged: open a browser, press the way to it, turn the pages. A press
      // can land before the page's scripts are attached and do nothing, so load the page again a
      // couple of times before settling for less.
      let best: AiToc | undefined = plain;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const walked = { first: "", pages: [] as Link[][], snaps: [] as { html: string; url: string }[] };
        const rendered = await renderPageHtml(storyUrl, {
          afterOpen: async (page) => {
            if (!lead || !(await pressControl(page, lead))) await revealList(provider, page, state);
            await walkTocPages(provider, page, state, walked, plain?.shape);
          },
        });
        let base = plain;
        if (!base) {
          try {
            base = await parseToc(provider, storyUrl, walked.first || rendered);
          } catch (err) {
            if (!(err instanceof NoChapterListError) || attempt >= 3) throw err;
            continue;
          }
        }
        // Every chapter link on the pages walked, titled from the list it sits in. When the plain
        // page only had a few of them (it needed a press), the walked list's titles win.
        const shape = base.shape;
        const merged = mergeChapters(
          base,
          walked.snaps.map((snap) => chapterLinksIn(snap.html, snap.url, storyUrl, shape)),
          plain !== undefined
        );
        if (!best || merged.chapters.length > best.chapters.length) best = merged;
        // The walk found more than the plain page had: done. Otherwise try the browser again.
        if (!plain || merged.chapters.length > plain.chapters.length) break;
      }
      if (!best) throw new NoChapterListError(t("Could not find a chapter list on {url}", { url: storyUrl }));
      return finalizeToc(best);
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
