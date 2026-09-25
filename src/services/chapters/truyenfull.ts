import { ExtractedChapter } from "../../types";
import { cloudflareBlockedMessage, isCloudflareChallenge } from "../cloudflare";
import { extractChapter, LockedContentError } from "../extractor";
import { renderPageHtml } from "../renderer";
import { loadSiteSession, sessionRequestHeaders } from "../siteSession";
import { fetchText } from "../toc/http";

export const TRUYENFULL_DOMAINS = ["truyenfull.vn", "truyenfull.live", "truyenhoan.com"];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Enough text to trust the server-sent HTML has the full chapter, not a stub waiting for JS.
const MIN_SERVED_TEXT = 500;

function textLength(chapter: ExtractedChapter): number {
  return chapter.blocks.reduce((total, block) => total + (block.text?.length ?? 0), 0);
}

/**
 * truyenfull serves the full chapter text in #chapter-c directly in the HTML — it's just
 * hidden by CSS behind an "click the ad to unlock" overlay, which extractChapter already
 * strips away (see extractor.ts). So no need to open a browser: on real chapters, raw fetch
 * takes 306ms vs. 2.1s through Chromium and produces exactly the same block structure.
 * A saved session's headers (cf_clearance plus the user agent it is bound to) ride along,
 * because without them Cloudflare now answers the raw request with its challenge page.
 *
 * When the raw request fails or the server-sent HTML doesn't have enough text — Cloudflare
 * challenge, site changed structure, or this chapter is rendered with JS — fall back to
 * browser rendering, rather than silently saving a truncated chapter.
 */
export async function fetchTruyenfullChapter(url: string): Promise<ExtractedChapter> {
  const html = await fetchServedHtml(url);
  if (html) {
    let served: ExtractedChapter | undefined;
    try {
      served = extractChapter(url, html);
    } catch (err) {
      // Locked chapters stay locked after rendering: report immediately to avoid wasting a retry.
      if (err instanceof LockedContentError) throw err;
    }
    if (served && textLength(served) >= MIN_SERVED_TEXT) return served;
  }

  const rendered = await renderPageHtml(url);
  if (isCloudflareChallenge(rendered)) {
    throw new Error(cloudflareBlockedMessage(url, !!loadSiteSession(url)));
  }
  return extractChapter(url, rendered);
}

// The raw HTML, or undefined when the request was challenged/failed — both mean "render it".
async function fetchServedHtml(url: string): Promise<string | undefined> {
  try {
    const html = await fetchText(url, { headers: { "User-Agent": USER_AGENT, ...sessionRequestHeaders(url) } });
    return isCloudflareChallenge(html) ? undefined : html;
  } catch {
    return undefined;
  }
}
