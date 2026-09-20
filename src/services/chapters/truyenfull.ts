import { ExtractedChapter } from "../../types";
import { extractChapter, LockedContentError } from "../extractor";
import { renderPageHtml } from "../renderer";
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
 *
 * When the server-sent HTML doesn't have enough text — site changed structure, or this chapter
 * is rendered with JS — fall back to browser rendering, rather than silently saving a truncated chapter.
 */
export async function fetchTruyenfullChapter(url: string): Promise<ExtractedChapter> {
  const html = await fetchText(url, { headers: { "User-Agent": USER_AGENT } });

  let served: ExtractedChapter | undefined;
  try {
    served = extractChapter(url, html);
  } catch (err) {
    // Locked chapters stay locked after rendering: report immediately to avoid wasting a retry.
    if (err instanceof LockedContentError) throw err;
  }
  if (served && textLength(served) >= MIN_SERVED_TEXT) return served;

  return extractChapter(url, await renderPageHtml(url));
}
