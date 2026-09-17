import { ExtractedChapter } from "../types";
import { extractChapter, LockedContentError } from "./extractor";
import { renderPageHtml } from "./renderer";

// Some sites' anti-tool scripts blank the page at random (see renderer.ts),
// and a cold browser session can take ~10 loads before it settles down, so
// the budget is generous — each attempt is a fresh page load, and a warm
// session succeeds on the first or second try.
export const MAX_ATTEMPTS = 12;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries render+extract a few times before giving up — some sites finish
// loading their chapter body slightly after network-idle, which makes
// extraction fail intermittently rather than consistently. On final failure
// this returns a chapter with `error` set instead of throwing, so the
// caller can still show/keep a slot for it (and offer a manual retry) rather
// than silently dropping it from the result set.
export async function extractWithRetry(
  url: string,
  onAttempt?: (attempt: number) => void
): Promise<ExtractedChapter> {
  let lastError = "Lỗi không xác định";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onAttempt?.(attempt);
    try {
      const html = await renderPageHtml(url);
      return extractChapter(url, html);
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError;
      // A locked chapter can't be unlocked by rendering again — fail fast
      // instead of burning the whole retry budget on it. (The preview UI
      // still offers a manual retry per chapter.)
      if (err instanceof LockedContentError) break;
      if (attempt < MAX_ATTEMPTS) await sleep(Math.min(1000 * attempt, 3000));
    }
  }
  return { sourceUrl: url, title: url, blocks: [], error: lastError };
}
