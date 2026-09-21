import { JSDOM } from "jsdom";
import { ContentBlock, ExtractedChapter } from "../../types";
import { LockedContentError, walkToBlocks } from "../extractor";
import { BlankedPageError, renderPageHtml } from "../renderer";
import { t } from "../lang";

export const ASIANFANFICS_DOMAINS = ["asianfanfics.com"];

// The chapter body is swapped in by htmx from a content-addressed fragment endpoint, and
// the div keeps its hx-get after the swap — so it is the exact content container. The
// cover-image div and the "couldn't be loaded" notice around it are site chrome.
// A foreword uses /htmx/story/ (its page is the story page).
const CONTENT_SELECTOR = "[hx-get*='/htmx/chapter/'], [hx-get*='/htmx/story/']";

export function parseAsianfanficsChapter(html: string, url: string): ExtractedChapter {
  const doc = new JSDOM(html, { url }).window.document;
  // h1 is the chapter title; the <title> tag is unreliable here because a Cloudflare
  // challenge can leave it stale ("Just a moment...") even on a fully rendered page.
  const title = doc.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() || url;
  const content = doc.querySelector(CONTENT_SELECTOR);
  const blocks: ContentBlock[] = [];
  if (content) walkToBlocks(content, blocks);

  if (blocks.length === 0) {
    const body = doc.body?.textContent ?? "";
    if (/subscribers only/i.test(body)) {
      throw new LockedContentError(
        t("This Asianfanfics content is for subscribers only — it needs an account subscribed to the author: {url}", {
          url,
        })
      );
    }
    if (/are you over 18\?/i.test(body)) {
      throw new LockedContentError(
        t(
          "This Asianfanfics content is rated M (mature) — it needs a logged-in account with mature content enabled: {url}",
          { url }
        )
      );
    }
    // Bot check page instead of the chapter: random per load, so retry immediately.
    if (/performing security verification|just a moment/i.test(body) || /just a moment/i.test(doc.title)) {
      throw new BlankedPageError(t("Page blanked before content could be read (temporary error, can retry): {url}", { url }));
    }
    throw new Error(
      t("Could not find chapter content at {url} — the site may have changed structure or the chapter is locked", {
        url,
      })
    );
  }

  return { sourceUrl: url, title, blocks };
}

export async function fetchAsianfanficsChapter(url: string): Promise<ExtractedChapter> {
  return parseAsianfanficsChapter(await renderPageHtml(url), url);
}
