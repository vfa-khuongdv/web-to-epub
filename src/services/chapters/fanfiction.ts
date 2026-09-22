import { JSDOM } from "jsdom";
import { ContentBlock, ExtractedChapter } from "../../types";
import { walkToBlocks } from "../extractor";
import { renderPageHtml } from "../renderer";
import { t } from "../lang";

export const FANFICTION_DOMAINS = ["fanfiction.net"];

// Cloudflare's interstitial, whatever it renders instead of the page.
const CLOUDFLARE_RE = /just a moment|performing security verification|enable javascript and cookies to continue/i;

function isNotFound(doc: Document): boolean {
  return /story not found|story is unavailable/i.test(doc.querySelector(".gui_warning")?.textContent ?? "");
}

// The site itself intermittently serves this notice for a chapter number its own
// #chap_select dropdown lists as valid — reproduced on a real story: the exact same URL
// (slug included) failed 6/6 in a row, then the SAME chapter that had failed earlier
// succeeded later with no change on our end. Site-side flakiness, not a dead URL — worth
// retrying, same as the Cloudflare interstitial below.
function isOutdatedChapterUrl(doc: Document): boolean {
  return /does not have any chapters|outdated url/i.test(doc.querySelector(".gui_normal")?.textContent ?? "");
}

// The site auto-numbers the selected option as "<value>. <author's title>" — strip that
// site-generated prefix by its exact value, same as the TOC adapter, so this always
// matches the clean title mergeStory already stored (see storyService.pickChapterTitle).
function selectedChapterTitle(doc: Document): string | undefined {
  const opt = doc.querySelector<HTMLOptionElement>("#chap_select option[selected]");
  const value = opt?.getAttribute("value");
  const raw = opt?.textContent?.replace(/\s+/g, " ").trim();
  if (!raw) return undefined;
  return value ? raw.replace(new RegExp(`^${value}\\.\\s*`), "") || raw : raw;
}

export function parseFanfictionChapter(html: string, url: string): ExtractedChapter {
  const doc = new JSDOM(html, { url }).window.document;
  // The site has no <h1>; the selected chapter-nav option carries the real chapter title.
  // One-shots have no dropdown at all, so fall back to the story title.
  const title =
    selectedChapterTitle(doc) ||
    doc.querySelector("#profile_top b.xcontrast_txt")?.textContent?.replace(/\s+/g, " ").trim() ||
    url;

  const content = doc.querySelector("#storytext");
  const blocks: ContentBlock[] = [];
  if (content) walkToBlocks(content, blocks);

  if (blocks.length === 0) {
    if (isNotFound(doc)) {
      throw new Error(t("Story not found on FanFiction.net — check the story URL again ({url})", { url }));
    }
    if (isOutdatedChapterUrl(doc)) {
      throw new Error(
        t("FanFiction.net briefly said this chapter doesn't exist — usually temporary on the site's end, try again ({url})", {
          url,
        })
      );
    }
    if (CLOUDFLARE_RE.test(doc.title) || CLOUDFLARE_RE.test(doc.body?.textContent ?? "")) {
      throw new Error(t("Cloudflare verification did not finish — try again in a moment ({url})", { url }));
    }
    throw new Error(
      t("Could not find chapter content at {url} — the site may have changed structure or the chapter is locked", {
        url,
      })
    );
  }

  return { sourceUrl: url, title, blocks };
}

export async function fetchFanfictionChapter(url: string): Promise<ExtractedChapter> {
  return parseFanfictionChapter(await renderPageHtml(url), url);
}
