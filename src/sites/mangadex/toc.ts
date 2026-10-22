import { APP_VERSION } from "../../config/appInfo";
import { fetchText } from "../../services/toc/http";
import { TocAdapter, TocChapter, TocResult } from "../../services/toc/types";
import { t } from "../../services/lang";

export const MANGADEX_DOMAINS = ["mangadex.org"];

const API = "https://api.mangadex.org";
// MangaDex asks API clients to send a User-Agent of their own instead of a browser's.
export const MANGADEX_HEADERS = { "User-Agent": `web-to-epub/${APP_VERSION}`, Accept: "application/json" };
const FEED_PAGE = 500;
// Picked when the story URL names no language (or one the manga has no chapters in).
const PREFERRED_LANGUAGES = ["vi", "en"];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

interface Relationship {
  id: string;
  type: string;
  attributes?: { name?: string; fileName?: string };
}

interface MangaData {
  id: string;
  attributes: {
    title?: Record<string, string>;
    altTitles?: Record<string, string>[];
    availableTranslatedLanguages?: (string | null)[];
  };
  relationships?: Relationship[];
}

export interface FeedChapter {
  id: string;
  attributes: {
    volume?: string | null;
    chapter?: string | null;
    title?: string | null;
    pages?: number;
    externalUrl?: string | null;
    publishAt?: string;
  };
  relationships?: Relationship[];
}

export interface MangadexManga {
  title: string;
  author?: string;
  coverUrl?: string;
  languages: string[];
}

// The site's own addresses: /title/<uuid>[/<slug>] for a manga, /chapter/<uuid> for a chapter.
export function parseMangadexId(url: string, kind: "title" | "chapter" = "title"): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const m = parsed.pathname.match(new RegExp(`^/${kind}/(${UUID})(?:/|$)`, "i"));
  return m ? m[1].toLowerCase() : undefined;
}

// The story URL keeps `?lang=` — each translation is its own book, so the language is part
// of the story's identity (same reasoning as Viet Messenger's `?title=`). The slug is dropped,
// and so is `?lang=vi`: a URL without a language already reads Vietnamese when there is
// any (pickLanguage), so the two would be the same book under two ids.
// Return the URL unchanged if it's not a manga page: /api/stories calls this outside try/catch.
export function normalizeMangadexStoryUrl(url: string): string {
  const id = parseMangadexId(url);
  if (!id) return url;
  const lang = new URL(url).searchParams.get("lang")?.trim();
  return mangadexStoryUrl(id, lang && lang !== PREFERRED_LANGUAGES[0] ? lang : undefined);
}

function mangadexStoryUrl(id: string, lang?: string): string {
  return `https://mangadex.org/title/${id}${lang ? `?${new URLSearchParams({ lang })}` : ""}`;
}

// One API answer, parsed. fetchText phrases a failed request (HTTP error, rate limit, dropped
// connection) the same way as for every other site.
export async function mangadexApi<T>(path: string, url: string): Promise<T> {
  const text = await fetchText(`${API}${path}`, { headers: MANGADEX_HEADERS });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(t("MangaDex API did not return JSON ({url})", { url }));
  }
}

export function parseManga(data: MangaData): MangadexManga {
  const attrs = data.attributes ?? {};
  const titles = attrs.title ?? {};
  const title =
    titles.en?.trim() ||
    Object.values(titles).find((x) => x?.trim())?.trim() ||
    (attrs.altTitles ?? []).map((alt) => alt.en ?? Object.values(alt)[0]).find((x) => x?.trim())?.trim() ||
    "Untitled";
  const rels = data.relationships ?? [];
  const authors = [
    ...new Set(rels.filter((r) => r.type === "author" || r.type === "artist").map((r) => r.attributes?.name?.trim())),
  ].filter((name): name is string => !!name);
  const coverFile = rels.find((r) => r.type === "cover_art")?.attributes?.fileName;
  return {
    title,
    author: authors.length ? authors.join(", ") : undefined,
    coverUrl: coverFile ? `https://uploads.mangadex.org/covers/${data.id}/${coverFile}` : undefined,
    languages: (attrs.availableTranslatedLanguages ?? []).filter((x): x is string => typeof x === "string"),
  };
}

export function pickLanguage(requested: string | undefined, available: string[]): string | undefined {
  if (requested && available.includes(requested)) return requested;
  return PREFERRED_LANGUAGES.find((lang) => available.includes(lang)) ?? available[0];
}

const groupsOf = (c: FeedChapter) =>
  (c.relationships ?? []).filter((r) => r.type === "scanlation_group").map((r) => r.id).sort().join(",");

const chapterNumber = (c: FeedChapter) => {
  const n = Number.parseFloat(c.attributes.chapter ?? "");
  return Number.isFinite(n) ? n : undefined;
};

// Several groups often translate the same chapter. Keep one per chapter number: the one
// from the group that translated the most of this feed (the series' "main" translation),
// then the earliest published. Chapters without a number (oneshots, extras) are all kept.
// Chapters hosted elsewhere (MangaPlus links) or with no pages cannot be read here.
export function pickChapters(feed: FeedChapter[]): FeedChapter[] {
  const readable = feed.filter((c) => !c.attributes.externalUrl && (c.attributes.pages ?? 0) > 0);
  const groupSize = new Map<string, number>();
  for (const c of readable) groupSize.set(groupsOf(c), (groupSize.get(groupsOf(c)) ?? 0) + 1);

  const best = new Map<number, FeedChapter>();
  const unnumbered: FeedChapter[] = [];
  for (const c of readable) {
    const n = chapterNumber(c);
    if (n === undefined) {
      unnumbered.push(c);
      continue;
    }
    const kept = best.get(n);
    const better =
      !kept ||
      (groupSize.get(groupsOf(c)) ?? 0) > (groupSize.get(groupsOf(kept)) ?? 0) ||
      ((groupSize.get(groupsOf(c)) ?? 0) === (groupSize.get(groupsOf(kept)) ?? 0) &&
        (c.attributes.publishAt ?? "") < (kept.attributes.publishAt ?? ""));
    if (better) best.set(n, c);
  }
  return [...[...best.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c), ...unnumbered];
}

export function chapterTitle(c: FeedChapter): string {
  const { volume, chapter, title } = c.attributes;
  const label = [volume ? `Vol. ${volume}` : "", chapter ? `Ch. ${chapter}` : ""].filter(Boolean).join(" ") || "Oneshot";
  return title?.trim() ? `${label} – ${title.trim()}` : label;
}

export function toTocChapters(feed: FeedChapter[]): TocChapter[] {
  return pickChapters(feed).map((c) => ({ url: `https://mangadex.org/chapter/${c.id}`, title: chapterTitle(c) }));
}

async function fetchFeed(id: string, lang: string, storyUrl: string): Promise<FeedChapter[]> {
  const all: FeedChapter[] = [];
  for (let offset = 0; ; offset += FEED_PAGE) {
    const query = new URLSearchParams({ limit: String(FEED_PAGE), offset: String(offset), "order[chapter]": "asc" });
    query.append("translatedLanguage[]", lang);
    query.append("includes[]", "scanlation_group");
    const page = await mangadexApi<{ data?: FeedChapter[]; total?: number }>(`/manga/${id}/feed?${query}`, storyUrl);
    const data = page.data ?? [];
    all.push(...data);
    if (data.length < FEED_PAGE || all.length >= (page.total ?? 0)) return all;
  }
}

async function loadManga(storyUrl: string): Promise<{ id: string; manga: MangadexManga }> {
  const id = parseMangadexId(storyUrl);
  if (!id) {
    throw new Error(
      t("This is not a MangaDex title page: {url} — paste a URL like https://mangadex.org/title/<id>", { url: storyUrl })
    );
  }
  const query = new URLSearchParams();
  query.append("includes[]", "author");
  query.append("includes[]", "artist");
  query.append("includes[]", "cover_art");
  const { data } = await mangadexApi<{ data: MangaData }>(`/manga/${id}?${query}`, storyUrl);
  return { id, manga: parseManga(data) };
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  const { id, manga } = await loadManga(storyUrl);
  const lang = pickLanguage(new URL(storyUrl).searchParams.get("lang") ?? undefined, manga.languages);
  if (!lang) {
    throw new Error(t("This manga has no translated chapters on MangaDex ({url})", { url: storyUrl }));
  }
  const chapters = toTocChapters(await fetchFeed(id, lang, storyUrl));
  if (chapters.length === 0) {
    throw new Error(
      t("No chapter of this manga can be read on MangaDex in this language ({lang}) — chapters hosted on other sites are skipped ({url})", {
        lang,
        url: storyUrl,
      })
    );
  }
  return { title: manga.title, author: manga.author, coverUrl: manga.coverUrl, chapters };
}

export const mangadexAdapter: TocAdapter = {
  domains: MANGADEX_DOMAINS,
  fetchToc,
  normalizeStoryUrl: normalizeMangadexStoryUrl,
};
