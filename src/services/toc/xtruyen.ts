import { JSDOM } from "jsdom";
import { fetchText, sleep } from "./http";
import { normalizeStoryUrl } from "./normalizeUrl";
import { TocAdapter, TocChapter, TocResult } from "./types";
import { t } from "../lang";

export const XTRUYEN_DOMAINS = ["xtruyen.vn"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
// xtruyen.vn's internal AJAX endpoint requires this static header (see manga-single.js
// and actual page requests); it's not user login info.
const CUSTOM_AUTH = "abC0000011111";
// API returns max 200 chapters per request (verified with from=1&to=200 → 200 items);
// a 100-item window doubled requests and hit 429 with long stories.
const CHAPTER_WINDOW = 200;
// Pause between windows to avoid exceeding the site's rate-limit threshold.
const WINDOW_DELAY_MS = 400;

export function parseMangaId(html: string): string | undefined {
  const doc = new JSDOM(html).window.document;
  return doc.querySelector<HTMLElement>("#manga-chapters-holder")?.dataset.id || undefined;
}

export function parseStoryMeta(html: string, pageUrl: string): { title: string; author?: string; coverUrl?: string } {
  const doc = new JSDOM(html).window.document;
  const title =
    doc.querySelector("h1")?.textContent?.trim() || doc.title.split(" - ")[0]?.trim() || "Untitled";
  const author = doc.querySelector(".author-content a")?.textContent?.trim() || undefined;
  const coverRaw = doc.querySelector<HTMLImageElement>(".summary_image img")?.getAttribute("src");
  let coverUrl: string | undefined;
  if (coverRaw) {
    try {
      coverUrl = new URL(coverRaw, pageUrl).toString();
    } catch {
      coverUrl = undefined;
    }
  }
  return { title, author, coverUrl };
}

// The API returns chapter names as HTML entities: "Quyển 1 Chương 0&nbsp;".
// Without decoding, "&nbsp;" appears literally in the chapter list and EPUB TOC.
// After decoding, collapse whitespace (including the newly-created U+00A0).
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: "\u00a0",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeChapterTitle(raw: string): string {
  return raw
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (!code.startsWith("#")) return NAMED_ENTITIES[code.toLowerCase()] ?? match;
      const value = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      if (!Number.isInteger(value) || value <= 0 || value > 0x10ffff) return match;
      return String.fromCodePoint(value);
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function parseChaptersResponse(text: string): { slug: string; title: string }[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t("xtruyen's chapter list API did not return JSON"));
  }
  if (!Array.isArray(data)) {
    throw new Error(t("xtruyen's chapter list API returned the wrong format"));
  }
  return data
    .filter((x): x is { s: string; n: string } => {
      const item = x as { s?: unknown; n?: unknown };
      return !!x && typeof item.s === "string" && typeof item.n === "string";
    })
    .map((x) => ({ slug: x.s, title: decodeChapterTitle(x.n) }));
}

export function buildChapterUrl(storyUrl: string, slug: string): string {
  return new URL(`${slug.replace(/^\/+/, "")}/`, storyUrl).toString();
}

async function fetchHtml(url: string): Promise<string> {
  return fetchText(url, { headers: { "User-Agent": USER_AGENT } });
}

async function postForm(url: string, body: string, referer: string): Promise<string> {
  return fetchText(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      "x-custom-auth": CUSTOM_AUTH,
      "X-Requested-With": "XMLHttpRequest",
      Referer: referer,
    },
    body,
  });
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  const pageHtml = await fetchHtml(storyUrl);
  const meta = parseStoryMeta(pageHtml, storyUrl);
  const mangaId = parseMangaId(pageHtml);
  if (!mangaId) {
    throw new Error(t("Story ID not found on the page at {url} — check the story URL again", { url: storyUrl }));
  }

  const apiUrl = new URL("/api/api-chapters.php", storyUrl).toString();
  const chapters: TocChapter[] = [];
  const seen = new Set<string>();

  for (let from = 1; ; from += CHAPTER_WINDOW) {
    if (from > 1) await sleep(WINDOW_DELAY_MS);
    const items = parseChaptersResponse(
      await postForm(
        apiUrl,
        new URLSearchParams({
          manga_id: mangaId,
          from: String(from),
          to: String(from + CHAPTER_WINDOW - 1),
          vol: "",
        }).toString(),
        storyUrl
      )
    );
    for (const { slug, title } of items) {
      const url = buildChapterUrl(storyUrl, slug);
      if (seen.has(url)) continue;
      seen.add(url);
      chapters.push({ url, title });
    }
    if (items.length < CHAPTER_WINDOW) break;
  }

  if (chapters.length === 0) {
    throw new Error(t("No chapter list found at {url} — check the story URL again", { url: storyUrl }));
  }

  const chapterNumber = (url: string) => {
    const m = url.match(/chuong-(\d+)/i);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  chapters.sort((a, b) => chapterNumber(a.url) - chapterNumber(b.url));
  return { ...meta, chapters };
}

export const xtruyenAdapter: TocAdapter = {
  domains: XTRUYEN_DOMAINS,
  fetchToc,
  normalizeStoryUrl,
};
