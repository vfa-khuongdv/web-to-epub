import { JSDOM } from "jsdom";
import { fetchText } from "./http";
import { normalizeStoryUrl } from "./normalizeUrl";
import { TocAdapter, TocChapter, TocResult } from "./types";
import { t } from "../lang";

export const TRUYENFULL_TEMPLATE_DOMAINS = [
  "truyenfull.live",
  "truyenfull.vn",
  "truyencom.com",
  "truyenhoan.com",
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MAX_TOC_PAGES = 1000;

export function parseStoryMeta(html: string, pageUrl: string): { title: string; author?: string; coverUrl?: string } {
  const doc = new JSDOM(html).window.document;
  const title =
    doc.querySelector("h3.title")?.textContent?.trim() ||
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title.split(" - ")[0]?.trim() ||
    "Untitled";
  const author = doc.querySelector('a[itemprop="author"]')?.textContent?.trim() || undefined;
  const coverRaw = doc.querySelector<HTMLImageElement>('img[itemprop="image"]')?.getAttribute("src");
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

export function parseChapterLinks(html: string, pageUrl: string): TocChapter[] {
  const doc = new JSDOM(html).window.document;
  const seen = new Set<string>();
  const out: TocChapter[] = [];
  doc.querySelectorAll("#list-chapter ul.list-chapter a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    let url: string;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, title: a.textContent?.replace(/\s+/g, " ").trim() || url });
  });
  return out;
}

export function parseTotalPages(html: string): number | undefined {
  const doc = new JSDOM(html).window.document;
  const hidden = doc.querySelector<HTMLInputElement>("#total-page")?.value;
  const hiddenNum = hidden ? Number(hidden) : NaN;
  if (Number.isFinite(hiddenNum) && hiddenNum > 0) return hiddenNum;

  let max = 0;
  doc.querySelectorAll('a[href*="trang-"]').forEach((a) => {
    const m = (a.getAttribute("href") || "").match(/trang-(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max > 0 ? max : undefined;
}

async function fetchHtml(url: string): Promise<string> {
  return fetchText(url, { headers: { "User-Agent": USER_AGENT } });
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  const firstHtml = await fetchHtml(storyUrl);
  const meta = parseStoryMeta(firstHtml, storyUrl);
  const chapters = parseChapterLinks(firstHtml, storyUrl);
  const seen = new Set(chapters.map((c) => c.url));

  const totalPages = Math.min(parseTotalPages(firstHtml) ?? MAX_TOC_PAGES, MAX_TOC_PAGES);
  for (let page = 2; page <= totalPages; page++) {
    const pageUrl = new URL(`trang-${page}/`, storyUrl).toString();
    const newOnes = parseChapterLinks(await fetchHtml(pageUrl), pageUrl).filter((c) => !seen.has(c.url));
    newOnes.forEach((c) => seen.add(c.url));
    if (newOnes.length === 0) break;
    chapters.push(...newOnes);
  }

  if (chapters.length === 0) {
    throw new Error(t("No chapter list found at {url} — check the story URL again", { url: storyUrl }));
  }
  return { ...meta, chapters };
}

export const truyenfullTemplateAdapter: TocAdapter = {
  domains: TRUYENFULL_TEMPLATE_DOMAINS,
  fetchToc,
  normalizeStoryUrl,
};
