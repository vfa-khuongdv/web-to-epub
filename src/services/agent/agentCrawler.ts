/**
 * Crawling a site the app has no adapter for by having a local coding agent write the crawler, the
 * way a site under src/sites/ has one written by hand:
 *
 *  1. The first time a site's story URL is added, the agent looks at the page and says whether it is
 *     the home page of a story at all (not a chapter, a listing, a search…).
 *  2. It then writes `toc(ctx)` — the story's title, author, cover and chapter list.
 *  3. At the first chapter crawled it reads one chapter page and writes `chapter(ctx)`.
 *
 * The app runs each piece of code on the page it was written from (siteSandbox.ts), accepts it only
 * if the result is a real chapter list / real chapter text, and keeps it in
 * DATA_DIR/agent-crawlers/<host>.<toc|chapter>.js. From then on that site is crawled by running the
 * saved code — no agent. When saved code stops working the agent is NOT asked again by itself: the
 * crawl says so, and the person rewrites it from the story's details (`rewriteCrawler`).
 *
 * The code is trusted no further than the page text it was written from: it runs in the sandbox, and
 * what it returns is checked and cleaned here (same host, http(s) only, inline HTML sanitised).
 */
import { JSDOM } from "jsdom";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../../config/paths";
import { ContentBlock, ExtractedChapter } from "../../types";
import type { ImportedBook } from "../epubImport";
import type { ChapterFetchContext } from "../chapters/types";
import { LockedContentError } from "../extractor";
import { t } from "../lang";
import { renderPageHtml } from "../renderer";
import { fetchWithRetry } from "../toc/http";
import { TocAdapter, TocChapter, TocResult } from "../toc/types";
import { reportAgent } from "./agentActivity";
import { activeAgent, AgentModel } from "./agentConfig";
import { analyse } from "./domClient";
import { collapse, hostOf, http } from "./domAnalysis";
import { savePictures } from "./pictures";
import { runSiteCode } from "./siteSandbox";

export class AgentNotEnabledError extends Error {}
export class AgentCrawlerError extends Error {}
// The page is one article / paper / book with all its text on it, not a story with a chapter list.
export class AgentDocumentPageError extends AgentCrawlerError {}

// The page analysis runs in a worker (domClient.ts); these are the same functions, for callers that want them inline.
export { articleMissing, missedChapters, missedPictures, pageScripts, skeleton } from "./domAnalysis";

const ATTEMPTS = 3;
// Fewer than this many chapter links / pictures left out is noise, not a broken crawler.
const MISSED_TOLERANCE = 3;
const MAX_CHAPTERS = 20_000;
const MIN_CHAPTER_CHARS = 200;

const codeDir = () => path.join(DATA_DIR, "agent-crawlers");
const codeFile = (host: string, fn: Fn) => path.join(codeDir(), `${host.replace(/[^a-z0-9.-]/gi, "_")}.${fn}.js`);

type Fn = "toc" | "chapter" | "article";

async function readCode(host: string, fn: Fn): Promise<string | undefined> {
  try {
    return await readFile(codeFile(host, fn), "utf8");
  } catch {
    return undefined;
  }
}

async function writeCode(host: string, fn: Fn, code: string): Promise<void> {
  await mkdir(codeDir(), { recursive: true });
  await writeFile(codeFile(host, fn), code);
}

function requireAgent(): AgentModel {
  const agent = activeAgent();
  if (!agent) throw new AgentNotEnabledError(t("The agent crawler is off or its agent is not installed (Settings → Agent crawler)"));
  return agent;
}

// The page as the server sends it; when that is an empty shell or refuses, what a browser shows.
async function loadPage(url: string): Promise<string> {
  let res: Response | undefined;
  try {
    res = await fetchWithRetry(url, {}, { maxAttempts: 2 });
  } catch {
    /* no answer at all: the browser may still get through */
  }
  if (res && res.status >= 500) throw new Error(t("Failed to fetch {url} (HTTP {status}){hint}", { url, status: res.status, hint: "" }));
  if (res?.ok) {
    const html = await res.text();
    if (html.length > 2000) return html;
  }
  return renderPageHtml(url);
}

// ---------- what the agent is shown ----------

const API = `You cannot run commands, open pages or search anything: everything you can know about the page is in the outline and the scripts below. Do not try to call tools; reply with the code.

The function receives one argument, ctx:
  ctx.url        the address of the page
  ctx.document   the page as a DOM Document (querySelector, querySelectorAll, textContent, getAttribute …)
  ctx.html       the page's HTML text
  await ctx.fetchText(url)   HTML/text of another page of THIS site (plain request)
  await ctx.fetchJson(url)   a JSON answer of THIS site (an API the page itself calls)
  await ctx.post(url, {field: value})      text answer of a form POST to THIS site (what a page's own script sends with $.ajax / fetch)
  await ctx.postJson(url, {field: value})  the same, parsed as JSON
  await ctx.render(url)      HTML of another page after a browser ran its scripts (slow; only when the plain page lacks the content)
  ctx.parseHtml(html, baseUrl)   a Document for HTML text
Rules: plain JavaScript (no TypeScript, no require/import, no fetch/XMLHttpRequest, no eval); only addresses of this site; absolute addresses (new URL(href, ctx.url).href).
The code is saved and then runs for EVERY story and chapter of this site, written once for the site as a whole: never put anything in it that belongs to the page you were shown — not its title, its story's name, slug or id, a chapter number, or an address copied from this page. Work out where things are from the page's structure and from ctx.url, so the same code is right on any other story or chapter of this site. Reply with the code only, in one code block.`;

const TOC_PROMPT = (url: string, outline: string, scripts: string, problem?: string) => `You write the crawler of a web-novel reader app. Below is a trimmed outline of the home page of a story (${url}). Each line is an element: <tag#id.classes href="…"> then the start of its text; "… +N similar" folds identical siblings.

Write the function
  async function toc(ctx) { … return { title, author, coverUrl, chapters: [{ url, title }, …] }; }
that returns the story's title, its author and cover picture (both optional) and EVERY chapter of THIS story, oldest first (reverse the list if the page shows the newest first). Skip menus, genres, other stories and "latest chapter" buttons. The outline folds look-alike items, so do not trust the first items to show the markup of all of them: items of one list often differ (a class only some have, another wrapper) — find the chapter links by what all of them share (the shape of their address, the list they sit in), not by the classes of the first ones. If the list is split into pages or loaded by an API, follow them until all chapters are collected.
${API}
${problem ? `\nYour previous code failed: ${problem}\n` : ""}
If the page's list or text is empty in the outline, its scripts probably load it with a request: look for it in the scripts and make the same request with ctx.post / ctx.fetchText / ctx.fetchJson, taking any value it sends (an id) from the page, never typing one in.

Outline:
${outline}

Scripts of the page:
${scripts}`;

const CHAPTER_PROMPT = (url: string, outline: string, scripts: string, problem?: string) => `You write the crawler of a web-novel reader app. Below is a trimmed outline of a chapter page (${url}). Each line is an element: <tag#id.classes href="…"> then the start of its text, with "[N chars of text]" on big containers; "… +N similar" folds identical siblings.

Write the function
  async function chapter(ctx) { … return { title, blocks: [ … ] }; }
that returns the chapter's title and its text as blocks: { type: "heading", level: 2, text }, { type: "paragraph", text } (text is HTML: the paragraph's innerHTML) and, for a comic whose pages are pictures, { type: "image", src, alt } for EVERY page. Pictures are often loaded lazily: some <img> have their real address in src while others keep a placeholder (a data: address) there and carry the real one in another attribute, whose name differs from site to site — the outline shows each <img>'s attributes; read them all and take the one that holds a real image address, never rely on src alone. Use an address the page itself already uses for that picture (its src, or the largest entry of its srcset): never build one by changing a size parameter such as width=, because an image server often refuses a size equal to the original's; when the full-size file is wanted, take it from the link around the picture or from that picture's own file page. Take only the chapter itself — no menus, comments, adverts, "next chapter" links or notices. A site that puts the text in one element with <br> lines needs those lines split into paragraphs.
If the page shows a login / subscription wall instead of the text, return { locked: true } — never try to get around it.
${API}
${problem ? `\nYour previous code failed: ${problem}\n` : ""}
If the page's list or text is empty in the outline, its scripts probably load it with a request: look for it in the scripts and make the same request with ctx.post / ctx.fetchText / ctx.fetchJson, taking any value it sends (an id) from the page, never typing one in.

Outline:
${outline}

Scripts of the page:
${scripts}`;

const ARTICLE_PROMPT = (url: string, outline: string, scripts: string, problem?: string) => `You write the crawler of a reader app. Below is a trimmed outline of a page (${url}) that is ONE readable text: an article, a research paper, an essay, or a whole book published as one page. Each line is an element: <tag#id.classes href="…"> then the start of its text, with "[N chars of text]" on big containers; "… +N similar" folds identical siblings.

Write the function
  async function article(ctx) { … return { title, author, coverUrl, chapters: [{ title, blocks: [ … ] }, …] }; }
that returns the text's title, its author and cover picture (both optional) and ALL of its text split into chapters. Blocks are { type: "heading", level: 2, text }, { type: "paragraph", text } (text is HTML: the paragraph's innerHTML) and { type: "image", src, alt } for figures that belong to the text (read every attribute of an <img>: lazy loading keeps a placeholder in src). Split into several chapters only when the text itself has big divisions (a book's chapters, a long paper's main sections), one chapter per division, titled as the text titles it; a short article is ONE chapter. Do not drop the text between divisions, and do not take only the first division: the chapters together must hold everything that is the text. Leave out menus, share buttons, comments, related links, adverts and cookie notices; keep the reference list of a paper and the footnotes of a book.
If the page shows a login / subscription wall instead of the text, return { locked: true } — never try to get around it.
${API}
${problem ? `\nYour previous code failed: ${problem}\n` : ""}
Outline:
${outline}

Scripts of the page:
${scripts}`;

function codeFrom(reply: string): string {
  const fenced = reply.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/i);
  return (fenced ? fenced[1] : reply).trim();
}

// ---------- checking what the code returned ----------

export function toTocResult(value: unknown, storyUrl: string): TocResult {
  const v = (value ?? {}) as Record<string, unknown>;
  const host = hostOf(storyUrl);
  const seen = new Set<string>();
  const chapters: TocChapter[] = [];
  for (const item of (Array.isArray(v.chapters) ? v.chapters : []).slice(0, MAX_CHAPTERS)) {
    const url = http((item as Record<string, unknown>)?.url, storyUrl)?.replace(/#.*$/, "");
    if (!url || seen.has(url) || hostOf(url) !== host) continue;
    seen.add(url);
    const title = (item as Record<string, unknown>).title;
    chapters.push({ url, title: (typeof title === "string" && collapse(title).slice(0, 300)) || url });
  }
  if (chapters.length === 0) throw new Error("toc() returned no chapter of this site");
  const text = (x: unknown) => (typeof x === "string" ? collapse(x).slice(0, 300) : "");
  return { title: text(v.title) || host, author: text(v.author) || undefined, coverUrl: http(v.coverUrl, storyUrl), chapters };
}

// Inline HTML from a page, cleaned: what the reader iframe and the EPUB should never receive as active content.
// Returns the cleaned HTML and its plain text; `close` frees the helper document.
function cleaner() {
  const dom = new JSDOM("<body></body>");
  const doc = dom.window.document;
  const clean = (html: string): { html: string; text: string } => {
    const box = doc.createElement("div");    box.innerHTML = html;
    box.querySelectorAll("script,style,iframe,object,embed,link,meta,form,base").forEach((el) => el.remove());
    for (const el of Array.from(box.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name) || (/^(href|src|xlink:href)$/i.test(attr.name) && /^\s*(javascript|data|vbscript):/i.test(attr.value))) el.removeAttribute(attr.name);
      }
    }
    return { html: box.innerHTML.trim(), text: box.textContent ?? "" };
  };
  return { clean, close: () => dom.window.close() };
}

function cleanBlocks(items: unknown, url: string): ContentBlock[] {
  const { clean, close } = cleaner();
  const blocks: ContentBlock[] = [];
  try {
    for (const item of Array.isArray(items) ? items : []) {
      const b = (item ?? {}) as Record<string, unknown>;
      if (b.type === "heading" && typeof b.text === "string" && collapse(b.text)) {
        const level = Number(b.level);
        blocks.push({ type: "heading", level: level >= 1 && level <= 6 ? level : 2, text: collapse(b.text) });
      } else if (b.type === "paragraph" && typeof b.text === "string") {
        const cleaned = clean(b.text);
        if (collapse(cleaned.text)) blocks.push({ type: "paragraph", text: cleaned.html });
      } else if (b.type === "image") {
        const src = http(b.src, url);
        if (src) blocks.push({ type: "image", src, alt: typeof b.alt === "string" ? b.alt.slice(0, 200) : "" });
      }
    }
  } finally {
    close();
  }
  return blocks;
}

const blockChars = (blocks: ContentBlock[]) => blocks.reduce((n, b) => n + (b.text?.length ?? 0), 0);

export function toChapter(value: unknown, url: string): ExtractedChapter {
  const v = (value ?? {}) as Record<string, unknown>;
  if (v.locked === true) {
    throw new LockedContentError(t("This chapter needs a login on the site, which the app does not bypass: {url}", { url }));
  }
  const blocks = cleanBlocks(v.blocks, url);
  if (blockChars(blocks) < MIN_CHAPTER_CHARS && !blocks.some((b) => b.type === "image")) throw new Error("chapter() returned almost no text");
  const title = typeof v.title === "string" && collapse(v.title) ? collapse(v.title).slice(0, 300) : url;
  return { sourceUrl: url, title, blocks, titleFromAi: true };
}

// One page that is a whole text (article, paper, book): its sections become the chapters. Text is counted
// without tags so the page's own paragraphs can be compared with what article() kept.
export function toArticle(value: unknown, url: string, html: string): ImportedBook & { coverUrl?: string } {
  const v = (value ?? {}) as Record<string, unknown>;
  if (v.locked === true) {
    throw new LockedContentError(t("This page needs a login on the site, which the app does not bypass: {url}", { url }));
  }
  const text = (x: unknown) => (typeof x === "string" ? collapse(x).slice(0, 300) : "");
  const chapters: ImportedBook["chapters"] = [];
  for (const item of (Array.isArray(v.chapters) ? v.chapters : []).slice(0, MAX_CHAPTERS)) {
    const c = (item ?? {}) as Record<string, unknown>;
    const blocks = cleanBlocks(c.blocks, url);
    if (blocks.length > 0) chapters.push({ title: text(c.title) || `${chapters.length + 1}`, blocks });
  }
  const chars = chapters.reduce((n, c) => n + blockChars(c.blocks), 0);
  if (chars < MIN_CHAPTER_CHARS) throw new Error("article() returned almost no text");
  return {
    title: text(v.title) || hostOf(url),
    author: text(v.author) || undefined,
    language: /<html[^>]*\blang\s*=\s*["']?([a-z]{2,3})\b/i.exec(html)?.[1]?.toLowerCase(),
    coverUrl: http(v.coverUrl, url),
    chapters,
  };
}

// The paragraphs on the page against the text article() returned: code that took only the first section of a
// long text (or one container of several) leaves most of it out. Menus and comments are paragraphs too, so
// only a result far below the page's paragraphs counts.
// ---------- writing and running ----------

const running = new Map<string, Promise<unknown>>();

// One writing per site at a time: a crawl fetches chapters in parallel and they all need the same script.
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  const current = running.get(key) as Promise<T> | undefined;
  if (current) return current;
  const started = make().finally(() => running.delete(key));
  running.set(key, started);
  return started;
}

// Asks the agent for code until `check` accepts it (it runs the code on the page and returns how much
// it produced: chapters, blocks), saves the accepted code and returns it. Up to ATTEMPTS tries, each
// told what was wrong with the last.
async function writeCrawler(
  agent: AgentModel,
  host: string,
  fn: Fn,
  prompt: (problem?: string) => string,
  check: (code: string) => Promise<number>
): Promise<string> {
  let problem: string | undefined;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      reportAgent({ kind: "ask", host, fn, agent: agent.name, attempt, of: ATTEMPTS });
      const started = Date.now();
      const code = codeFrom(await agent.complete(prompt(problem)));
      reportAgent({ kind: "answer", host, fn, agent: agent.name, ms: Date.now() - started });
      const count = await check(code);
      await writeCode(host, fn, code);
      reportAgent({ kind: "saved", host, fn, count });
      return code;
    } catch (err) {
      if (err instanceof LockedContentError) throw err;
      problem = err instanceof Error ? err.message : String(err);
      if (attempt < ATTEMPTS) reportAgent({ kind: "retry", host, fn, reason: problem });
    }
  }
  reportAgent({ kind: "failed", host, fn, reason: problem });
  throw new AgentCrawlerError(t("The agent could not write a crawler for {host}: {reason}", { host, reason: problem ?? "" }));
}

// The saved code, or — only when there is none — the code `write` produces. Pages fetched in parallel
// wait for the one writing, then each runs the code on its own page.
async function savedOrWritten(host: string, fn: Fn, write: () => Promise<string>): Promise<{ code: string; saved: boolean }> {
  const saved = await readCode(host, fn);
  if (saved) return { code: saved, saved: true };
  return once(`${fn}:${host}`, async () => {
    const existing = await readCode(host, fn);
    return existing ? { code: existing, saved: true } : { code: await write(), saved: false };
  });
}

// Saved code in use is worth one line per site and part, not one per chapter.
const reported = new Set<string>();
function reportReuse(host: string, fn: Fn) {
  if (reported.has(`${host}:${fn}`)) return;
  reported.add(`${host}:${fn}`);
  reportAgent({ kind: "reuse", host, fn });
}

// Saved code that no longer works is the person's call: say so, point at the way to rewrite it.
function broken(host: string, fn: Fn, err: unknown): AgentCrawlerError {
  const reason = err instanceof Error ? err.message : String(err);
  reportAgent({ kind: "stale", host, fn, reason });
  return new AgentCrawlerError(
    t("The saved crawler for {host} stopped working ({reason}). Open the story's details and rewrite it with the agent.", { host, reason })
  );
}

// The saved code runs for every story and chapter of the site, so it must not contain what belongs to the one
// page it was written from. A path segment that looks like a story's slug or id (several words joined by
// hyphens, or a number) found inside the code is exactly that.
export function hardcodedFrom(code: string, pageUrl: string): string | null {
  const url = new URL(pageUrl);
  // An id can sit in the query (`?book=12345`) as well as in the path.
  for (const raw of [...url.pathname.split("/"), ...Array.from(url.searchParams.values())]) {
    let segment = raw;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      /* keep as is */
    }
    const looksSpecific = segment.length >= 4 && (/\d/.test(segment) || (segment.match(/-/g) ?? []).length >= 2);
    if (looksSpecific && code.includes(segment)) return segment;
  }
  return null;
}

// A reply with no function in it is not code: a model that wanted to look at the page itself and was told it has no
// tools answers with its attempted tool calls. Say that, instead of letting those be judged as code.
function requireFunction(code: string, fn: Fn): void {
  if (!new RegExp(`function\\s+${fn}\\s*\\(`).test(code)) {
    throw new Error(
      `The reply holds no \`async function ${fn}(ctx)\`. You have no tools — you cannot run commands, open or search pages — so do not try; ` +
        `everything you can know about the page is in the outline and the scripts you were given. Reply with the code only.`
    );
  }
}

function rejectHardcoded(code: string, pageUrl: string): void {
  const segment = hardcodedFrom(code, pageUrl);
  if (segment) {
    throw new Error(
      `The code contains "${segment}", copied from this page's own address. The same code will run for other stories and chapters of this site, ` +
        `so it must not contain anything that belongs to this one: work out where things are from the page's structure and from ctx.url.`
    );
  }
}

// ---------- 1. is this a story page? ----------

const CLASSIFY_PROMPT = (url: string, outline: string) => `You help a reader app decide what a web address is. Below is a trimmed outline of the page at ${url}. Each line is an element: <tag#id.classes href="…"> then the start of its text; "… +N similar" folds identical siblings.

Is this page
- "story": the HOME PAGE OF ONE STORY — the page that presents a single novel or comic and lists its chapters;
- "document": ONE readable text with all of it on this page — a news article, blog post, research paper, essay, or a whole book / long text published as a single page;
- "chapter": one chapter of a story that has a separate chapter list;
- "other": a site home, genre or search listing, login, error, product page, anything else.

Answer with ONE JSON object and nothing else: {"kind": "story" | "document" | "chapter" | "other", "reason": "one short sentence"}

Outline:
${outline}`;

async function classifyUrl(agent: AgentModel, url: string, html: string): Promise<void> {
  const host = hostOf(url);
  reportAgent({ kind: "classify", host, fn: "url", agent: agent.name });
  const started = Date.now();
  let kind = "";
  let reason = "";
  try {
    const reply = await agent.complete(CLASSIFY_PROMPT(url, await analyse("skeleton", html, url)));
    const answer = JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1)) as Record<string, unknown>;
    kind = typeof answer.kind === "string" ? answer.kind.trim().toLowerCase() : "";
    reason = typeof answer.reason === "string" ? answer.reason.slice(0, 300) : "";
  } catch {
    // An answer that cannot be read does not block the crawl: the code written next is tested on this page anyway.
    reportAgent({ kind: "verdict", host, fn: "url", agent: agent.name, ms: Date.now() - started, reason: "" });
    return;
  }
  reportAgent({ kind: "verdict", host, fn: "url", agent: agent.name, ms: Date.now() - started, verdict: kind, reason });
  if (kind === "document") throw new AgentDocumentPageError(reason || kind);
  if (kind === "chapter" || kind === "other") {
    throw new AgentCrawlerError(t("This does not look like the home page of a story: {reason}", { reason: reason || kind }));
  }
}

// ---------- 2. the story: title, author, cover, chapter list ----------

const runToc = async (code: string, storyUrl: string, html: string) =>
  toTocResult(await runSiteCode({ code, fn: "toc", url: storyUrl, html }), storyUrl);

// Links on the page, addressed like the chapters toc() returned, that it left out; null when none (or too few to matter).
async function missedMessage(html: string, storyUrl: string, toc: TocResult): Promise<string | null> {
  const { shape, missed, unreadPages } = await analyse("missedChapters", html, storyUrl, toc);
  if (unreadPages > 0) {
    return (
      `toc() returned only the ${toc.chapters.length} chapters this page itself lists, but the page links to ${unreadPages} more pages of the list (?page=2 … ?page=${unreadPages + 1}). ` +
      `Fetch those pages with ctx.fetchText and collect their chapters too. Their links may name another domain of the same site: keep the path and read it against ctx.url's origin`
    );
  }
  if (missed.length < MISSED_TOLERANCE) return null;
  const sample = missed.slice(0, 3).map((c) => `"${c.title}" (${c.url})`).join(", ");
  return `toc() returned ${toc.chapters.length} chapters, but this page has ${missed.length} more links addressed like ${shape} that it left out, for example ${sample}`;
}

async function writeTocCrawler(agent: AgentModel, storyUrl: string, html: string): Promise<string> {
  // Parsing the page is slow, so the outline and scripts are made once, not once per attempt.
  const [outline, scripts] = await Promise.all([analyse("skeleton", html, storyUrl), analyse("pageScripts", html, storyUrl)]);
  return writeCrawler(agent, hostOf(storyUrl), "toc", (problem) => TOC_PROMPT(storyUrl, outline, scripts, problem), async (code) => {
    requireFunction(code, "toc");
    rejectHardcoded(code, storyUrl);
    const toc = await runToc(code, storyUrl, html);
    const missing = await missedMessage(html, storyUrl, toc);
    if (missing) {
      throw new Error(
        `${missing}. The chapter links of one list often do not share the same markup (a class only some of them have, another container): ` +
          `find them by what they all share, such as the shape of their address, instead of by the classes of the first items.`
      );
    }
    return toc.chapters.length;
  });
}

export async function tocViaAgent(agent: AgentModel, storyUrl: string): Promise<TocResult> {
  const host = hostOf(storyUrl);
  const html = await loadPage(storyUrl);
  const { code, saved } = await savedOrWritten(host, "toc", async () => {
    await classifyUrl(agent, storyUrl, html);
    return writeTocCrawler(agent, storyUrl, html);
  });
  try {
    const toc = await runToc(code, storyUrl, html);
    if (saved) {
      // Saved code can predate the completeness check, or the site can have changed: a list with chapters
      // left out is a broken crawler, not a short story.
      const missing = await missedMessage(html, storyUrl, toc);
      if (missing) throw new Error(missing);
      reportReuse(host, "toc");
    }
    return toc;
  } catch (err) {
    throw saved ? broken(host, "toc", err) : err;
  }
}

// ---------- 3. one chapter ----------

const runChapter = async (code: string, url: string, html: string) =>
  toChapter(await runSiteCode({ code, fn: "chapter", url, html }), url);

// Pictures of the chapter's list that the result leaves out, described for the agent / the person.
async function picturesMissing(html: string, url: string, chapter: ExtractedChapter): Promise<string | null> {
  const { shape, missed } = await analyse("missedPictures", html, url, chapter);
  if (missed.length < MISSED_TOLERANCE) return null;
  const returned = chapter.blocks.filter((b) => b.type === "image").length;
  return `chapter() returned ${returned} pictures, but the same list on this page has ${missed.length} more addressed like ${shape} that it left out, for example ${missed.slice(0, 3).join(", ")}`;
}

async function writeChapterCrawler(agent: AgentModel, url: string, html: string): Promise<string> {
  // Parsing the page is slow, so the outline and scripts are made once, not once per attempt.
  const [outline, scripts] = await Promise.all([analyse("skeleton", html, url), analyse("pageScripts", html, url)]);
  return writeCrawler(agent, hostOf(url), "chapter", (problem) => CHAPTER_PROMPT(url, outline, scripts, problem), async (code) => {
    requireFunction(code, "chapter");
    rejectHardcoded(code, url);
    const chapter = await runChapter(code, url, html);
    const missing = await picturesMissing(html, url, chapter);
    if (missing) {
      throw new Error(
        `${missing}. Pages that load pictures lazily keep a placeholder (a data: address) in src and the real address in another attribute: ` +
          `read every attribute of each <img> and take the one that holds a real image address.`
      );
    }
    return chapter.blocks.length;
  });
}

export async function chapterViaAgent(agent: AgentModel, url: string): Promise<ExtractedChapter> {
  const host = hostOf(url);
  const html = await loadPage(url);
  try {
    const { code, saved } = await savedOrWritten(host, "chapter", () => writeChapterCrawler(agent, url, html));
    try {
      const chapter = await runChapter(code, url, html);
      if (saved) {
        // Code saved before the picture check existed, or a site that changed: pictures left out make a broken chapter.
        const missing = await picturesMissing(html, url, chapter);
        if (missing) throw new Error(missing);
        reportReuse(host, "chapter");
      }
      return chapter;
    } catch (err) {
      if (err instanceof LockedContentError) throw err;
      // One odd chapter is not proof that the code is wrong; the chapter just fails and can be retried.
      throw saved ? broken(host, "chapter", err) : err;
    }
  } catch (err) {
    if (err instanceof LockedContentError) reportAgent({ kind: "locked", host, fn: "chapter", reason: url });
    throw err;
  }
}

// ---------- 4. a page that is one whole text (article, paper, book) ----------

const runArticle = async (code: string, url: string, html: string) =>
  toArticle(await runSiteCode({ code, fn: "article", url, html }), url, html);

async function writeArticleCrawler(agent: AgentModel, url: string, html: string): Promise<string> {
  // Parsing the page is slow, so the outline and scripts are made once, not once per attempt.
  const [outline, scripts] = await Promise.all([analyse("skeleton", html, url), analyse("pageScripts", html, url)]);
  return writeCrawler(agent, hostOf(url), "article", (problem) => ARTICLE_PROMPT(url, outline, scripts, problem), async (code) => {
    requireFunction(code, "article");
    rejectHardcoded(code, url);
    const article = await runArticle(code, url, html);
    const missing = await analyse("articleMissing", html, url, article);
    if (missing) {
      throw new Error(
        `${missing}. The text may sit in several containers, or only the first section was taken: collect every section of the text, ` +
          `finding them by what they share instead of by the first one.`
      );
    }
    return article.chapters.length;
  });
}

// Reads the page at `url` as a book: the saved code for its site when there is one, else the agent writes it.
// Unlike a story's crawl code, a page is read once, so it is the person adding it who is waiting for the answer.
export async function articleViaAgent(agent: AgentModel, url: string): Promise<ImportedBook & { coverUrl?: string }> {
  const host = hostOf(url);
  const html = await loadPage(url);
  const { code, saved } = await savedOrWritten(host, "article", () => writeArticleCrawler(agent, url, html));
  const read = async (source: string) => {
    const article = await runArticle(source, url, html);
    const missing = await analyse("articleMissing", html, url, article);
    if (missing && saved) throw new Error(missing);
    return article;
  };
  try {
    const article = await read(code);
    if (saved) reportReuse(host, "article");
    return article;
  } catch (err) {
    if (err instanceof LockedContentError || !saved) throw err;
    // There is no story yet whose details could offer a rewrite, and the person asked for this very page:
    // the agent writes the code again, and it replaces the saved one only if it reads this page.
    reportAgent({ kind: "stale", host, fn: "article", reason: err instanceof Error ? err.message : String(err) });
    return runArticle(await once(`rewrite:${host}`, () => writeArticleCrawler(agent, url, html)), url, html);
  }
}

export const hasArticleCrawler = async (url: string): Promise<boolean> => (await readCode(hostOf(url), "article")) !== undefined;

// An article is stored under `web:<address>`: the address stays readable, and the prefix says what it is.
export const WEB_PAGE_PREFIX = "web:";
export const webStoryUrl = (url: string): string => WEB_PAGE_PREFIX + url.replace(/#.*$/, "");

// ---------- on the person's request ----------

// Writes both parts again — from the story page and from one of its chapters — replacing the saved code
// only when the new code passes the same checks. Nothing runs this by itself.
export async function rewriteCrawler(agent: AgentModel, options: { storyUrl: string; chapterUrl?: string }): Promise<void> {
  if (options.storyUrl.startsWith(WEB_PAGE_PREFIX)) {
    const url = options.storyUrl.slice(WEB_PAGE_PREFIX.length);
    await once(`rewrite:${hostOf(url)}`, async () => void (await writeArticleCrawler(agent, url, await loadPage(url))));
    return;
  }
  const host = hostOf(options.storyUrl);
  await once(`rewrite:${host}`, async () => {
    await writeTocCrawler(agent, options.storyUrl, await loadPage(options.storyUrl));
    if (options.chapterUrl) await writeChapterCrawler(agent, options.chapterUrl, await loadPage(options.chapterUrl));
  });
}

export const hasAgentCrawler = async (storyUrl: string): Promise<boolean> => {
  if (storyUrl.startsWith(WEB_PAGE_PREFIX)) return hasArticleCrawler(storyUrl.slice(WEB_PAGE_PREFIX.length));
  return (await readCode(hostOf(storyUrl), "toc")) !== undefined || (await readCode(hostOf(storyUrl), "chapter")) !== undefined;
};

// ---------- what the rest of the app calls ----------

export function createAgentTocAdapter(): TocAdapter {
  return {
    domains: [],
    normalizeStoryUrl: (url) => url,
    fetchToc: (storyUrl) => tocViaAgent(requireAgent(), storyUrl),
  };
}

// A comic's pictures are kept as links while the site lets anyone load them, and saved in the story's
// media folder when it does not (see pictures.ts).
export async function fetchChapterWithAgent(url: string, context?: ChapterFetchContext): Promise<ExtractedChapter> {
  const chapter = await chapterViaAgent(requireAgent(), url);
  if (context && chapter.blocks.some((b) => b.type === "image")) {
    return { ...chapter, blocks: await savePictures(chapter.blocks, url, context) };
  }
  return chapter;
}
