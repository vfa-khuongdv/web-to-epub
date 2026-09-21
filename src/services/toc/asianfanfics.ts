import { JSDOM } from "jsdom";
import { sleep } from "./http";
import { renderPageHtml } from "../renderer";
import { loadSiteSession } from "../siteSession";
import { TocAdapter, TocChapter, TocResult } from "./types";
import { t } from "../lang";

export const ASIANFANFICS_DOMAINS = ["asianfanfics.com"];

// Story pages are /story/view/<id>[/<slug>] and chapter pages /story/view/<id>/<n>/<slug>.
// Only the numeric id identifies the story; the slug is the title and changes when the
// author renames it, so normalized URLs keep the id alone and stay stable for hashing.
const STORY_ID_RE = /^\/story\/view\/(\d+)(?:\/|$)/;

// Cloudflare sometimes serves its bot-check page instead of the story (see renderer.ts);
// a fresh render usually gets the real page, so a few attempts are worth it.
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 1000;
// Cloudflare's interstitial, whatever it renders instead of the page.
const CLOUDFLARE_RE = /just a moment|performing security verification|enable javascript and cookies to continue/i;

export function parseAsianfanficsStoryId(url: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  return pathname.match(STORY_ID_RE)?.[1];
}

// Return the URL unchanged if it's not a story page (instead of throwing): /api/stories
// calls this outside try/catch, so fetchToc will report the real error later.
export function normalizeAsianfanficsStoryUrl(url: string): string {
  const storyId = parseAsianfanficsStoryId(url);
  return storyId ? `https://www.asianfanfics.com/story/view/${storyId}` : url;
}

export function parseStoryPage(html: string, pageUrl: string): TocResult {
  const doc = new JSDOM(html).window.document;
  const title = doc.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() || "Untitled";
  const author = doc.querySelector('main a[href^="/profile/u/"]')?.textContent?.trim() || undefined;
  const coverRaw = doc.querySelector<HTMLImageElement>("img[src*='story_cover']")?.getAttribute("src");
  let coverUrl: string | undefined;
  if (coverRaw) {
    try {
      coverUrl = new URL(coverRaw, pageUrl).toString();
    } catch {
      coverUrl = undefined;
    }
  }

  // The TOC appears twice on the page (desktop sidebar + mobile sheet), so dedupe by URL
  // and keep the first occurrence, which is document order = chapter order.
  const chapters: TocChapter[] = [];
  const seen = new Set<string>();
  doc.querySelectorAll<HTMLAnchorElement>("a[data-toc-chapter]").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href) return;
    let url: string;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    if (seen.has(url)) return;
    seen.add(url);
    // Chapter number and mature badge sit outside .truncate; the span holds the clean title.
    const label = a.querySelector(".truncate")?.textContent ?? a.textContent ?? "";
    chapters.push({ url, title: label.replace(/\s+/g, " ").trim() || url });
  });

  return { title, author, coverUrl, chapters };
}

function headerText(doc: Document): string {
  return doc.querySelector("main header")?.textContent ?? "";
}

// The site renders this bar on every page; a Log In link in it means the request was
// served as a guest, whatever cookies we sent.
function isLoggedOut(doc: Document): boolean {
  const bar = doc.querySelector("header[data-aff-userbar-shell]");
  return !!bar && !!bar.querySelector('a[href="/login"]');
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS);

    let html: string;
    try {
      html = await renderPageHtml(storyUrl);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }

    const doc = new JSDOM(html).window.document;
    // A saved session the site no longer honours: the account's access token lasts about an
    // hour, after which every chapter would come back as a guest-level teaser. Stop at the
    // add with that reason. Retried first — one mis-served guest page must not fail the add.
    if (loadSiteSession(storyUrl) && isLoggedOut(doc)) {
      lastError = new Error(
        t(
          "Saved Asianfanfics session has expired — log in again in your browser, then re-import it in Settings → Site sessions: {url}",
          { url: storyUrl }
        )
      );
      continue;
    }

    const toc = parseStoryPage(html, storyUrl);
    if (toc.chapters.length > 0) return toc;

    // These are final states, not transient load failures — a retry cannot unlock them.
    // The age gate is checked first: on a story that is both rated M and subscribers-only,
    // a guest sees the gate, and "log in" is the actionable part of that.
    if (/are you over 18\?/i.test(doc.body?.textContent ?? "")) {
      throw new Error(
        t(
          "This Asianfanfics content is rated M (mature) — it needs a logged-in account with mature content enabled: {url}",
          { url: storyUrl }
        )
      );
    }
    if (/subscribers only/i.test(headerText(doc))) {
      throw new Error(
        t("This Asianfanfics content is for subscribers only — it needs an account subscribed to the author: {url}", {
          url: storyUrl,
        })
      );
    }
    if (/page not found/i.test(doc.querySelector("h1")?.textContent ?? "")) {
      throw new Error(t("Story not found on Asianfanfics — check the story URL again ({url})", { url: storyUrl }));
    }
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

export const asianfanficsAdapter: TocAdapter = {
  domains: ASIANFANFICS_DOMAINS,
  fetchToc,
  normalizeStoryUrl: normalizeAsianfanficsStoryUrl,
};
