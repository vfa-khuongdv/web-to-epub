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

// Trang bị script chống tool xoá trắng là chuyện ngẫu nhiên của từng lượt tải,
// không phải site đang chặn mình — đo được khoảng một nửa số lượt tải xtruyen
// dính, và lượt tải ngay sau đó thường qua. Chờ vài giây rồi mới tải lại gần
// như là chờ không, nên loại lỗi này thử lại gần như ngay. Các lỗi khác (mạng
// chập chờn, site trả 429/5xx) vẫn giữ backoff tăng dần.
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
  let lastError = "Lỗi không xác định";
  const siteFetcher = getChapterFetcher(url);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onAttempt?.(attempt);
    try {
      // Site đã server-render sẵn nội dung (vd. Wattpad) có fetcher riêng:
      // tải HTML trực tiếp, nhanh hơn nhiều so với mở trình duyệt từng chương.
      if (siteFetcher) return await siteFetcher.fetchChapter(url);
      const html = await renderPageHtml(url);
      return extractChapter(url, html);
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError;
      // A locked chapter can't be unlocked by rendering again — fail fast
      // instead of burning the whole retry budget on it. (The preview UI
      // still offers a manual retry per chapter.)
      if (err instanceof LockedContentError) break;
      if (attempt < MAX_ATTEMPTS) await sleep(retryDelayMs(err, attempt));
    }
  }
  return { sourceUrl: url, title: url, blocks: [], error: lastError };
}
