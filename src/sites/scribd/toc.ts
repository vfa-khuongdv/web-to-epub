import { JSDOM } from "jsdom";
import { renderPageHtml } from "../../services/renderer";
import { loadSiteSession } from "../../services/siteSession";
import { sleep } from "../../services/toc/http";
import { TocAdapter, TocChapter, TocResult } from "../../services/toc/types";
import { t } from "../../services/lang";

export const SCRIBD_DOMAINS = ["scribd.com"];

// Scribd documents carry no chapter structure of their own (outlineData is empty on
// everything sampled), so a document without an outline is cut into page chunks, the same
// way an outline-less PDF import is (services/pdfImport.ts).
export const SCRIBD_PAGES_PER_CHAPTER = 20;

// The viewer page is a heavy SPA behind a bot challenge; a fresh render usually gets
// through, so a couple of retries are worth it (see renderer.ts).
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 700;

/** A page the account cannot view (Scribd's per-page `blur` flag). Never fetched. */
export class ScribdLockedError extends Error {}
/** The page rendered as a login wall instead of the viewer. */
export class ScribdLoginRequiredError extends Error {}

const DOC_ID_RE = /^\/document\/(\d+)(?:\/|$)/;
const documentUrl = (id: string) => `https://www.scribd.com/document/${id}`;

const CHALLENGE_RE = /client challenge|a required part of this site couldn.t load/i;
const LOGIN_RE = /sign in to (continue|read|scribd)|log in to scribd/i;

export function parseScribdDocumentId(url: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  return pathname.match(DOC_ID_RE)?.[1];
}

// Return the URL unchanged if it's not a document page (instead of throwing): /api/stories
// calls this outside try/catch, so fetchToc will report the real error later.
export function normalizeScribdStoryUrl(url: string): string {
  const id = parseScribdDocumentId(url);
  return id ? documentUrl(id) : url;
}

export interface ScribdPage {
  pageNum: number;
  blur: boolean;
  contentUrl: string;
}

export interface ScribdOutlineEntry {
  title: string;
  page: number;
}

export interface ScribdDocument {
  title: string;
  coverUrl?: string;
  pages: ScribdPage[];
  outline: ScribdOutlineEntry[];
  // Scribd serves these documents' text through scrambled fonts (an anti-extraction
  // measure): the DOM text is not the visible text, so their pages are captured as
  // images instead (see chapter.ts).
  scrambled: boolean;
}

// The page ships the viewer's data twice: a docInfo JSON fragment (metadata) and one
// docManager.addPage call per page, carrying the page's payload URL and its blur flag —
// the ground truth for what this account may see.
const ADD_PAGE_RE = /docManager\.addPage\(\{([\s\S]*?)\}\)\s*;/g;

function jsonString(html: string, key: string): string | undefined {
  const match = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(html);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return undefined;
  }
}

// The array value of a JSON key, matched by brackets (outlineData entries may nest).
function jsonArray(html: string, key: string): unknown[] | undefined {
  const start = html.indexOf(`"${key}":`);
  if (start < 0) return undefined;
  const open = html.indexOf("[", start);
  if (open < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) {
      try {
        const value: unknown = JSON.parse(html.slice(open, i + 1));
        return Array.isArray(value) ? value : undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function parsePages(html: string): ScribdPage[] {
  const pages: ScribdPage[] = [];
  for (const match of html.matchAll(ADD_PAGE_RE)) {
    const block = match[1];
    const pageNum = Number(/pageNum:\s*(\d+)/.exec(block)?.[1]);
    const contentUrl = /contentUrl:\s*"([^"]+)"/.exec(block)?.[1];
    if (!Number.isFinite(pageNum) || !contentUrl) continue;
    pages.push({ pageNum, blur: /blur:\s*true/.test(block), contentUrl });
  }
  return pages.sort((a, b) => a.pageNum - b.pageNum);
}

function parseOutline(html: string, pageCount: number): ScribdOutlineEntry[] {
  const raw = jsonArray(html, "outlineData") ?? [];
  const entries: ScribdOutlineEntry[] = [];
  for (const item of raw) {
    const entry = item as { title?: unknown; page?: unknown };
    if (typeof entry?.title !== "string" || typeof entry?.page !== "number") continue;
    const page = Math.floor(entry.page);
    const title = entry.title.trim();
    if (!title || page < 1 || page > pageCount) continue;
    entries.push({ title, page });
  }
  return entries
    .sort((a, b) => a.page - b.page)
    .filter((entry, index, all) => index === 0 || entry.page > all[index - 1].page);
}

/**
 * Read the viewer data out of a rendered document page. Throws ScribdLockedError when any
 * page is blurred for this account (no partial book is ever saved), ScribdLoginRequiredError
 * when the page is a login wall, and a retryable error when the bot check or a transient
 * render left no viewer.
 */
export function parseScribdDocument(html: string, pageUrl: string): ScribdDocument {
  const pages = parsePages(html);
  if (pages.length === 0) {
    if (CHALLENGE_RE.test(html)) {
      throw new Error(t("Scribd's bot check did not finish — try again in a moment ({url})", { url: pageUrl }));
    }
    if (LOGIN_RE.test(new JSDOM(html).window.document.body?.textContent ?? "")) {
      throw new ScribdLoginRequiredError(
        t(
          "This Scribd document needs a login — import a Scribd session from your browser (Settings → Site sessions), then try again: {url}",
          { url: pageUrl }
        )
      );
    }
    throw new Error(
      t(
        "No document viewer found at {url} — check the document URL again; if it needs a login, import a Scribd session first",
        { url: pageUrl }
      )
    );
  }

  const blurred = pages.find((page) => page.blur);
  if (blurred) {
    throw new ScribdLockedError(
      t(
        "This Scribd document is only partly viewable (page {page} is locked) — import a Scribd session from an account that can view it, then try again: {url}",
        { page: blurred.pageNum, url: pageUrl }
      )
    );
  }

  const fallbackTitle = new JSDOM(html).window.document.title.replace(/\s*\|\s*PDF\s*$/i, "").trim();
  return {
    title: jsonString(html, "title")?.trim() || fallbackTitle || "Untitled",
    coverUrl: /"originalImageUrl":"([^"]+)"/.exec(html)?.[1],
    pages,
    outline: parseOutline(html, pages.length),
    scrambled: /"hasScrambledFonts":\s*true/.test(html),
  };
}

/**
 * Split a document into chapters: its own outline when it has one, else fixed page chunks.
 * Chapter URLs carry the page range in the fragment, e.g. `#pages=21-40`.
 */
export function scribdChapters(document: ScribdDocument, pageUrl: string): TocChapter[] {
  const pageCount = document.pages.length;
  const chapter = (from: number, to: number, title: string): TocChapter => ({
    url: `${pageUrl}#pages=${from}-${to}`,
    title,
  });
  const chunkTitle = (from: number, to: number) => t("Pages {from}–{to}", { from, to });

  if (document.outline.length > 0) {
    const chapters: TocChapter[] = [];
    const first = document.outline[0].page;
    if (first > 1) chapters.push(chapter(1, first - 1, chunkTitle(1, first - 1)));
    document.outline.forEach((entry, index) => {
      const to = index + 1 < document.outline.length ? document.outline[index + 1].page - 1 : pageCount;
      if (entry.page <= to) chapters.push(chapter(entry.page, to, entry.title));
    });
    return chapters;
  }

  const chapters: TocChapter[] = [];
  for (let from = 1; from <= pageCount; from += SCRIBD_PAGES_PER_CHAPTER) {
    const to = Math.min(from + SCRIBD_PAGES_PER_CHAPTER - 1, pageCount);
    chapters.push(chapter(from, to, chunkTitle(from, to)));
  }
  return chapters;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

// A render of the document page is ~10s of heavy SPA, and a crawl needs it for the TOC
// plus every chapter fetch: the parse is kept here, keyed by document id. It is invalidated
// when the saved session changes (a fresh login may see pages the old one could not) or
// after the TTL, so a retry after importing a session re-reads the page.
const DOCUMENT_CACHE_TTL_MS = 10 * 60_000;
const documentCache = new Map<string, { sessionSavedAt?: string; at: number; document: ScribdDocument }>();

export function currentSessionSavedAt(url: string): string | undefined {
  try {
    return loadSiteSession(url)?.savedAt;
  } catch {
    // A broken session file is reported when the crawl loads the session; caching must not fail.
    return undefined;
  }
}

export async function renderScribdDocument(canonical: string): Promise<ScribdDocument> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS);

    let html: string;
    try {
      html = await renderPageHtml(canonical);
    } catch (err) {
      lastError = toError(err);
      continue;
    }

    try {
      return parseScribdDocument(html, canonical);
    } catch (err) {
      lastError = toError(err);
      // A blurred page or a login wall cannot change by re-rendering.
      if (err instanceof ScribdLockedError || err instanceof ScribdLoginRequiredError) throw err;
    }
  }
  throw lastError ?? new Error(t("No document viewer found at {url}", { url: canonical }));
}

/**
 * The document's page list (and metadata), from the in-memory cache when a recent parse
 * exists for the same saved session, else freshly rendered. Used by the chapter fetcher.
 */
export async function loadScribdDocument(url: string): Promise<ScribdDocument> {
  const id = parseScribdDocumentId(url);
  if (!id) {
    throw new Error(
      t("This is not a Scribd document page: {url} — paste a URL like https://www.scribd.com/document/<id>", {
        url,
      })
    );
  }
  const document = documentCache.get(id);
  const savedAt = currentSessionSavedAt(documentUrl(id));
  if (document && document.sessionSavedAt === savedAt && Date.now() - document.at < DOCUMENT_CACHE_TTL_MS) {
    return document.document;
  }
  const parsed = await renderScribdDocument(documentUrl(id));
  documentCache.set(id, { sessionSavedAt: savedAt, at: Date.now(), document: parsed });
  return parsed;
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  const id = parseScribdDocumentId(storyUrl);
  if (!id) {
    throw new Error(
      t("This is not a Scribd document page: {url} — paste a URL like https://www.scribd.com/document/<id>", {
        url: storyUrl,
      })
    );
  }
  const canonical = documentUrl(id);

  const document = await renderScribdDocument(canonical);
  // Seed the cache so the crawl that follows does not render the same page again.
  documentCache.set(id, { sessionSavedAt: currentSessionSavedAt(canonical), at: Date.now(), document });
  return { title: document.title, coverUrl: document.coverUrl, chapters: scribdChapters(document, canonical) };
}

export const scribdAdapter: TocAdapter = {
  domains: SCRIBD_DOMAINS,
  fetchToc,
  normalizeStoryUrl: normalizeScribdStoryUrl,
};
