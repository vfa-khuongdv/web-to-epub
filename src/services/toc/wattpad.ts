import { fetchText } from "./http";
import { TocAdapter, TocChapter, TocResult } from "./types";
import { t } from "../lang";

export const WATTPAD_DOMAINS = ["wattpad.com"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Wattpad's story page is an SPA — the server-sent HTML doesn't contain a chapter list,
// so the adapter uses Wattpad's internal API that the web client calls. The API returns all
// parts in one request (tested on a 110-chapter story), no pagination needed.
const STORY_FIELDS = "id,title,user(name),cover,parts(id,title,url)";

interface WattpadStoryResponse {
  title?: string;
  user?: { name?: string };
  cover?: string;
  parts?: { url?: string; title?: string }[];
  error_type?: string;
  message?: string;
}

function storyApiUrl(storyId: string): string {
  return `https://www.wattpad.com/api/v3/stories/${storyId}?fields=${STORY_FIELDS}`;
}

export function parseWattpadStoryId(url: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const m = pathname.match(/^\/story\/(\d+)(?:[/-]|$)/);
  return m ? m[1] : undefined;
}

// Return the URL unchanged if it's not a story page (instead of throwing): /api/stories
// calls this outside try/catch, so fetchToc will report the real error later.
export function normalizeWattpadStoryUrl(url: string): string {
  const storyId = parseWattpadStoryId(url);
  return storyId ? `https://www.wattpad.com/story/${storyId}` : url;
}

export function parseWattpadStory(text: string, storyUrl: string): TocResult {
  let data: WattpadStoryResponse;
  try {
    data = JSON.parse(text) as WattpadStoryResponse;
  } catch {
    throw new Error(t("Wattpad's chapter list API did not return JSON ({url})", { url: storyUrl }));
  }

  if (!data || typeof data !== "object") {
    throw new Error(t("Wattpad's chapter list API did not return JSON ({url})", { url: storyUrl }));
  }

  if (data.error_type) {
    const detail = data.message ? `: ${data.message}` : "";
    if (data.error_type === "NotFound") {
      throw new Error(t("Story not found on Wattpad{detail} — check the story URL again ({url})", { detail, url: storyUrl }));
    }
    throw new Error(t("Wattpad API error ({type}){detail} ({url})", { type: data.error_type, detail, url: storyUrl }));
  }

  const chapters: TocChapter[] = (Array.isArray(data.parts) ? data.parts : [])
    .filter((p): p is { url: string; title?: string } => !!p && typeof p.url === "string" && p.url.length > 0)
    .map((p) => ({ url: p.url, title: p.title?.trim() || p.url }));

  if (chapters.length === 0) {
    throw new Error(t("No chapter list found at {url} — check the story URL again", { url: storyUrl }));
  }

  return {
    title: data.title?.trim() || "Untitled",
    author: data.user?.name?.trim() || undefined,
    coverUrl: data.cover || undefined,
    chapters,
  };
}

export async function fetchToc(storyUrl: string): Promise<TocResult> {
  const storyId = parseWattpadStoryId(storyUrl);
  if (!storyId) {
    throw new Error(
      t("This is not a Wattpad story page: {url} — paste a URL like https://www.wattpad.com/story/<id>", {
        url: storyUrl,
      })
    );
  }
  const text = await fetchText(storyApiUrl(storyId), { headers: { "User-Agent": USER_AGENT } });
  return parseWattpadStory(text, storyUrl);
}

export const wattpadAdapter: TocAdapter = {
  domains: WATTPAD_DOMAINS,
  fetchToc,
  normalizeStoryUrl: normalizeWattpadStoryUrl,
};
