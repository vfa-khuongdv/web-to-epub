import { JSDOM } from "jsdom";
import { t } from "../../services/lang";
import { fetchText, sleep } from "../../services/toc/http";
import { normalizeStoryUrl } from "../../services/toc/normalizeUrl";
import { TocAdapter, TocChapter, TocResult } from "../../services/toc/types";

export const TRUYENDECU_DOMAINS = ["truyendecu.store"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
// The story page ships an empty list container; its own script fills it from this WordPress
// AJAX action, one page at a time. A page with no new chapter ends the loop, the cap only
// keeps a misbehaving answer from looping forever.
const MAX_PAGES = 200;
const PAGE_DELAY_MS = 300;

export function parseStoryId(html: string): string | undefined {
  return html.match(/\bmainStoryId\s*=\s*(\d+)/)?.[1];
}

export function parseStoryMeta(html: string, pageUrl: string): { title: string; author?: string; coverUrl?: string } {
  const doc = new JSDOM(html).window.document;
  // The first <h1> on the page is the site's logo; the story's own title sits beside the cover.
  const title =
    doc.querySelector(".flex-1.min-w-0 > h1")?.textContent?.trim() ||
    doc.querySelector<HTMLMetaElement>("meta[property='og:title']")?.content.split(" - ")[0]?.trim() ||
    "Untitled";
  let author: string | undefined;
  for (const label of Array.from(doc.querySelectorAll("p"))) {
    if (label.textContent?.trim().toLowerCase() !== "tác giả") continue;
    const value = label.nextElementSibling?.textContent?.trim();
    if (value && value.toLowerCase() !== "đang cập nhật") author = value;
    break;
  }
  const coverRaw = doc.querySelector<HTMLMetaElement>("meta[property='og:image']")?.content;
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

export function parseChapterList(listHtml: string, storyUrl: string): TocChapter[] {
  const doc = new JSDOM(listHtml).window.document;
  const chapters: TocChapter[] = [];
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a.chapter-item"))) {
    const href = a.getAttribute("href");
    if (!href) continue;
    let url: string;
    try {
      url = new URL(href, storyUrl).toString();
    } catch {
      continue;
    }
    // The first span is the running number, the second the chapter's name.
    const spans = a.querySelectorAll("span");
    const title = (spans[1] ?? spans[0])?.textContent?.replace(/\s+/g, " ").trim() || a.textContent?.trim() || url;
    chapters.push({ url, title });
  }
  return chapters;
}

async function fetchChapterPage(ajaxUrl: string, storyId: string, paged: number, referer: string): Promise<string> {
  const text = await fetchText(ajaxUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Referer: referer,
    },
    body: new URLSearchParams({
      action: "story_core_load_frontend_chapters",
      story_id: storyId,
      paged: String(paged),
      context: "main",
    }).toString(),
  });
  try {
    const data = JSON.parse(text) as { success?: boolean; data?: { html?: unknown } };
    if (data.success && typeof data.data?.html === "string") return data.data.html;
  } catch {
    // falls through to the error below
  }
  throw new Error(t("truyendecu's chapter list API returned the wrong format"));
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  const pageHtml = await fetchText(storyUrl, { headers: { "User-Agent": USER_AGENT } });
  const storyId = parseStoryId(pageHtml);
  if (!storyId) {
    throw new Error(t("Story ID not found on the page at {url} — check the story URL again", { url: storyUrl }));
  }

  const ajaxUrl = new URL("/wp-admin/admin-ajax.php", storyUrl).toString();
  const chapters: TocChapter[] = [];
  const seen = new Set<string>();
  for (let paged = 1; paged <= MAX_PAGES; paged++) {
    if (paged > 1) await sleep(PAGE_DELAY_MS);
    let added = 0;
    for (const chapter of parseChapterList(await fetchChapterPage(ajaxUrl, storyId, paged, storyUrl), storyUrl)) {
      if (seen.has(chapter.url)) continue;
      seen.add(chapter.url);
      chapters.push(chapter);
      added++;
    }
    if (added === 0) break;
  }

  if (chapters.length === 0) {
    throw new Error(t("No chapter list found at {url} — check the story URL again", { url: storyUrl }));
  }
  return { ...parseStoryMeta(pageHtml, storyUrl), chapters };
}

export const truyendecuAdapter: TocAdapter = {
  domains: TRUYENDECU_DOMAINS,
  fetchToc,
  normalizeStoryUrl,
};
