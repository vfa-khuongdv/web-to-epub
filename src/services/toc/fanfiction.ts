import { JSDOM } from "jsdom";
import { sleep } from "./http";
import { renderPageHtml } from "../renderer";
import { TocAdapter, TocChapter, TocResult } from "./types";
import { t } from "../lang";

export const FANFICTION_DOMAINS = ["fanfiction.net"];

// Story/chapter pages are /s/<id>/<chapterNumber>/<slug>. Only the numeric id identifies
// the story, but the slug is NOT reliably optional in practice: the site intermittently
// serves "Story does not have any chapters. ... outdated url" for a bare /<id>/<n>/ request
// that resolves fine once the story's own slug is appended (reproduced on a real story:
// same slug-less URL failed 5/5 then, minutes later, another chapter number failed 5/5
// while succeeding every time with the slug). Always carry the slug through.
const STORY_ID_RE = /^\/s\/(\d+)(?:\/|$)/;

// Cloudflare sometimes serves its bot-check page instead of the story (see renderer.ts);
// a fresh render usually gets the real page, so a few attempts are worth it.
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 1000;
// Cloudflare's interstitial, whatever it renders instead of the page.
const CLOUDFLARE_RE = /just a moment|performing security verification|enable javascript and cookies to continue/i;

export function parseFanfictionStoryId(url: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  return pathname.match(STORY_ID_RE)?.[1];
}

// The slug segment of a /s/<id>/<n>/<slug> URL, if present.
function slugFromPathname(pathname: string): string | undefined {
  return pathname.split("/").filter(Boolean)[3] || undefined;
}

// Return the URL unchanged if it's not a story page (instead of throwing): /api/stories
// calls this outside try/catch, so fetchToc will report the real error later.
export function normalizeFanfictionStoryUrl(url: string): string {
  const storyId = parseFanfictionStoryId(url);
  if (!storyId) return url;
  // Keep whatever slug the caller's URL already carries for this first render — the site's
  // own canonical slug (used for every other chapter) is only known once that page loads.
  const slug = slugFromPathname(new URL(url).pathname);
  return `https://www.fanfiction.net/s/${storyId}/1/${slug ?? ""}`;
}

// The chapter dropdown's own onchange always builds the URL as
// '/s/<id>/' + <value> + '/<story-slug>' — the last quoted literal is the canonical slug
// every chapter shares. Reading it here means every constructed chapter URL below matches
// exactly what the site's own navigation would send a real browser to.
function canonicalSlug(doc: Document, pageUrl: string): string | undefined {
  const onchange = doc.querySelector("#chap_select")?.getAttribute("onchange") ?? "";
  const literals = [...onchange.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const fromOnchange = literals[literals.length - 1]?.replace(/^\/+/, "");
  if (fromOnchange) return fromOnchange;
  // One-shots have no dropdown; fall back to whatever slug the page was reached with.
  try {
    return slugFromPathname(new URL(pageUrl).pathname);
  } catch {
    return undefined;
  }
}

// The site auto-numbers every option as "<value>. <author's title>" — our own chapter
// list already shows the position in its own column, so keep just the author's title
// (matches "1. Chapter 1" for both position 1 and a chapter the author separately named
// "Chapter 1" showing up at a different position — the "N. " here is always the site's
// own prefix, stripped by exact value match rather than a generic leading-number regex).
function chapterTitleFromOption(opt: HTMLOptionElement, value: string): string {
  const raw = opt.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return raw.replace(new RegExp(`^${value}\\.\\s*`), "") || `Chapter ${value}`;
}

export function parseStoryPage(html: string, pageUrl: string): TocResult {
  const doc = new JSDOM(html, { url: pageUrl }).window.document;
  const profile = doc.querySelector("#profile_top");
  const title = profile?.querySelector("b.xcontrast_txt")?.textContent?.replace(/\s+/g, " ").trim() || "Untitled";
  const author = profile?.querySelector<HTMLAnchorElement>('a[href^="/u/"]')?.textContent?.trim() || undefined;
  const coverUrl = profile?.querySelector<HTMLImageElement>("img.cimage")?.src || undefined;

  const storyId = parseFanfictionStoryId(pageUrl);
  const slug = canonicalSlug(doc, pageUrl);
  const chapterUrl = (value: string) => `https://www.fanfiction.net/s/${storyId}/${value}/${slug ?? ""}`;

  const chapters: TocChapter[] = [];
  const seen = new Set<string>();
  // The dropdown is repeated (top + bottom chapter nav), so dedupe by option value.
  doc.querySelectorAll<HTMLOptionElement>("#chap_select option[value]").forEach((opt) => {
    const value = opt.getAttribute("value");
    if (!value || seen.has(value) || !storyId) return;
    seen.add(value);
    chapters.push({ url: chapterUrl(value), title: chapterTitleFromOption(opt, value) });
  });

  // One-shots have no chapter dropdown at all — the story page itself is the only chapter.
  // Checked by actual text, not mere presence: a genuinely broken/blocked page can still
  // carry an empty #storytext, and that must not be mistaken for a real one-shot.
  if (chapters.length === 0 && storyId && doc.querySelector("#storytext")?.textContent?.trim()) {
    chapters.push({ url: chapterUrl("1"), title });
  }

  return { title, author, coverUrl, chapters };
}

function isNotFound(doc: Document): boolean {
  return /story not found|story is unavailable/i.test(doc.querySelector(".gui_warning")?.textContent ?? "");
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  const normalized = normalizeFanfictionStoryUrl(storyUrl);
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS);

    let html: string;
    try {
      html = await renderPageHtml(normalized);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }

    const doc = new JSDOM(html).window.document;
    if (isNotFound(doc)) {
      throw new Error(t("Story not found on FanFiction.net — check the story URL again ({url})", { url: storyUrl }));
    }

    const toc = parseStoryPage(html, normalized);
    if (toc.chapters.length > 0) return toc;

    // Cloudflare's interstitial instead of the story: worth retrying, and worth telling the
    // reader that — "no chapter list found" would send them looking at the URL instead.
    if (CLOUDFLARE_RE.test(doc.title) || CLOUDFLARE_RE.test(doc.body?.textContent ?? "")) {
      lastError = new Error(t("Cloudflare verification did not finish — try again in a moment ({url})", { url: storyUrl }));
      continue;
    }
    lastError = new Error(t("No chapter list found at {url} — check the story URL again", { url: storyUrl }));
  }
  throw lastError ?? new Error(t("No chapter list found at {url} — check the story URL again", { url: storyUrl }));
}

export const fanfictionAdapter: TocAdapter = {
  domains: FANFICTION_DOMAINS,
  fetchToc,
  normalizeStoryUrl: normalizeFanfictionStoryUrl,
};
