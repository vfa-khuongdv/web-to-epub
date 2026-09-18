import { ExtractedChapter } from "../types";
import { getChapterFetcher } from "./chapters";
import { extractChapter, LockedContentError } from "./extractor";
import { BlankedPageError, renderPageHtml } from "./renderer";

// Some sites' anti-tool scripts blank the page at random (see renderer.ts),
// and a cold browser session can take ~10 loads before it settles down, so
// the budget is generous — each attempt is a fresh page load, and a warm
// session succeeds on the first or second try.
export const MAX_ATTEMPTS = 12;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Estimate time remaining based on average speed of completed chapters in current
// crawl. Less than 3 samples is too little (one slow chapter/retry skews heavily),
// so return undefined to keep the UI from showing noise.
export function estimateRemainingMs(input: {
  startedAt: number;
  completed: number;
  total: number;
  now?: number;
}): number | undefined {
  const now = input.now ?? Date.now();
  const elapsed = now - input.startedAt;
  if (input.completed < 3 || input.completed >= input.total || elapsed <= 0) return undefined;
  return Math.round((elapsed / input.completed) * (input.total - input.completed));
}

// Anti-tool scripts blanking the page happen randomly per load, not site blocking
// — observed on ~half of xtruyen loads, and next load usually succeeds. Waiting
// seconds before retrying is almost pointless, so this error retries immediately.
// Other errors (network hiccups, site returns 429/5xx) still use increasing backoff.
const BLANKED_RETRY_MS = 300;

function retryDelayMs(err: unknown, attempt: number): number {
  return err instanceof BlankedPageError ? BLANKED_RETRY_MS : Math.min(1000 * attempt, 3000);
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
  let lastError = "Unknown error";
  const siteFetcher = getChapterFetcher(url);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onAttempt?.(attempt);
    try {
      // Sites that server-render content (e.g., Wattpad) have their own fetcher:
      // load HTML directly, much faster than opening a browser per chapter.
      if (siteFetcher) return await siteFetcher.fetchChapter(url);
      const html = await renderPageHtml(url);
      return extractChapter(url, html);
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError;
      // Locked chapter can't be unlocked by re-rendering — fail fast instead
      // of wasting the whole retry budget. (The preview UI still offers manual
      // retry per chapter.)
      if (err instanceof LockedContentError) break;
      if (attempt < MAX_ATTEMPTS) await sleep(retryDelayMs(err, attempt));
    }
  }
  return { sourceUrl: url, title: url, blocks: [], error: lastError };
}
