import { JSDOM } from "jsdom";
import { ContentBlock, ExtractedChapter } from "../../types";
import { walkToBlocks } from "../../services/extractor";
import { t } from "../../services/lang";
import { fetchText } from "../../services/toc/http";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Banner ads, "you may like" cards and the unlock notice the site puts inside the text.
const NOISE = ".story-banner-ads-wrapper, .maybe-like-container, .story-ads-inline-container, script, style";

// From chapter 2 on the server sends only the first part of the text behind a "click the ad"
// overlay (#storyAdsOverlay). Clicking it runs one request to this AJAX action and swaps in
// the full text — the same request is made here, so the person gets what the click shows.
const FULL_CHAPTER_ACTION = "story_get_full_chapter";

function chapterId(html: string): string | undefined {
  return html.match(/action=story_get_full_chapter&(?:amp;)?chapter_id=(\d+)/)?.[1] ?? html.match(/\bpostid-(\d+)/)?.[1];
}

export function parseChapter(url: string, html: string, fullHtml?: string): ExtractedChapter {
  const doc = new JSDOM(html).window.document;
  const heading = Array.from(doc.querySelectorAll("h1")).pop()?.textContent?.trim();
  const title = heading || doc.title.split(" - ")[0]?.trim() || "Untitled";

  const root = fullHtml ? new JSDOM(`<div id="c">${fullHtml}</div>`).window.document.getElementById("c") : doc.querySelector("#chapter-content");
  if (!root) throw new Error(t("Chapter content not found at {url}", { url }));
  root.querySelectorAll(NOISE).forEach((el) => el.remove());

  const blocks: ContentBlock[] = [];
  walkToBlocks(root, blocks);
  return { sourceUrl: url, title, blocks };
}

export async function fetchTruyendecuChapter(url: string): Promise<ExtractedChapter> {
  const html = await fetchText(url, { headers: { "User-Agent": USER_AGENT } });
  if (!html.includes("storyAdsOverlay")) return parseChapter(url, html);

  const id = chapterId(html);
  if (!id) throw new Error(t("Chapter content not found at {url}", { url }));
  const ajaxUrl = new URL("/wp-admin/admin-ajax.php", url);
  ajaxUrl.search = new URLSearchParams({ action: FULL_CHAPTER_ACTION, chapter_id: id }).toString();
  const answer = await fetchText(ajaxUrl.toString(), { headers: { "User-Agent": USER_AGENT, Referer: url } });
  let content: unknown;
  try {
    content = (JSON.parse(answer) as { data?: { content?: unknown } }).data?.content;
  } catch {
    content = undefined;
  }
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(t("Chapter content not found at {url}", { url }));
  }
  return parseChapter(url, html, content);
}
