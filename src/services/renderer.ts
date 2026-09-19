import { Browser, chromium } from "playwright";
import { t } from "./lang";

let browserPromise: Promise<Browser> | null = null;

// Chromium process memory grows with each opened page, and crawling hundreds of
// chapters (plus retries) packs thousands of loads into one process. Swap browser
// every ~this-many loads to reclaim swollen memory — don't set too low: first load
// on fresh browser clocks ~4.7s (cold start).
const RENDERS_PER_BROWSER = 500;
// After crawl, don't keep Chromium alive just sitting and eating RAM.
const IDLE_CLOSE_MS = 60_000;

let rendersOnBrowser = 0;
// Count of open pages: only swap/close browser when none are open, otherwise
// parallel crawls beside will have their browser closed mid-stream.
let openPages = 0;
let idleTimer: NodeJS.Timeout | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    // Chromium sandbox needs user namespace — unavailable in containers, so
    // Docker image sets CHROMIUM_NO_SANDBOX=1; local runs keep sandbox.
    const args = process.env.CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];
    // Launch failure: discard promise. Keeping a rejected promise means all
    // following chapters fail too and never retry.
    browserPromise = chromium.launch({ headless: true, args }).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const closing = browserPromise;
  if (!closing) return;
  // Drop reference before await: pages calling during close must open a new
  // browser, not reuse the one being closed.
  browserPromise = null;
  rendersOnBrowser = 0;
  try {
    await (await closing).close();
  } catch {
    // If browser is already dead, count it as closed.
  }
}

function armIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (openPages === 0) void closeBrowser();
  }, IDLE_CLOSE_MS);
  // This timer must not keep the process alive.
  idleTimer.unref();
}

async function releasePage(): Promise<void> {
  openPages--;
  if (openPages > 0) return;
  if (rendersOnBrowser >= RENDERS_PER_BROWSER) await closeBrowser();
  else armIdleClose();
}

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Some sites ship anti-tool scripts that blank the document (then navigate to
// about:blank) at random — misfires on headless. Measured on xtruyen: content
// arrives ~2.4s, blanked ~4.6s, so valid HTML is in hand before blanking. The
// settle loop captures the best version it saw; if blanked, use that snapshot
// instead of discarding the load and retrying. Only if no snapshot yet does error
// go to extractWithRetry to retry.
const SETTLE_MIN_MS = 500;
const SETTLE_MAX_MS = 6000;
const MIN_RENDERED_HTML_LENGTH = 1500;
// Enough text to trust content arrived, not just page shell. Old threshold was
// 3000 chars absolute, so short chapters never exited early and always burned
// full SETTLE_MAX_MS even when content was stable long ago.
const MIN_SETTLED_TEXT = 500;

type PageState = { blanked: boolean; height: number; textLength: number };

/**
 * Page blanked by anti-tool script before content was read. This is random per
 * load, not site blocking, so caller can retry immediately without backoff
 * (see extractWithRetry).
 */
export class BlankedPageError extends Error {}

/**
 * Renders a URL like a real browser (executes JS/CSS) and returns the fully
 * rendered DOM as serialized HTML. Since this reads page.content() directly
 * from the DOM tree rather than going through the browser's selection/
 * clipboard pipeline, CSS `user-select: none`, `oncopy`/`oncontextmenu`
 * handlers and similar copy-blocking scripts have no effect on it.
 */
export async function renderPageHtml(url: string): Promise<string> {
  // Increment before await: while waiting for browser and opening page, another
  // thread shouldn't consider it idle and swap/close browser immediately.
  openPages++;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  try {
    const browser = await getBrowser();
    rendersOnBrowser++;
    const context = await browser.newContext({ userAgent: BROWSER_USER_AGENT });
    try {
      const page = await context.newPage();
      // "networkidle" is unreliable in practice: sites with continuous
      // background traffic (ads, analytics beacons, chat widgets) never reach
      // it and the navigation just times out, even though the actual chapter
      // content rendered almost immediately. "domcontentloaded" plus the
      // bounded settle loop below is faster and more robust across sites.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

      // Scrolls to the bottom repeatedly so lazy-loaded / infinite-scroll
      // content mounts into the DOM, stopping once the page height settles.
      // Runs for at most SETTLE_MAX_MS so a stalled page can't hang the crawl.
      const start = Date.now();
      let lastHeight = -1;
      let lastTextLength = -1;
      let stableRounds = 0;
      // Snapshot with most text ever seen; kept to rescue load blanked by script.
      let snapshot = "";
      let snapshotTextLength = 0;
      let blanked = false;

      while (Date.now() - start < SETTLE_MAX_MS) {
        const state: PageState = await page
          .evaluate((): PageState => {
            if (location.href === "about:blank" || !document.body || document.body.childElementCount === 0) {
              return { blanked: true, height: 0, textLength: 0 };
            }
            return {
              blanked: false,
              height: document.body.scrollHeight,
              textLength: document.body.innerText.length,
            };
          })
          .catch(() => ({ blanked: true, height: 0, textLength: 0 }));

        if (state.blanked) {
          blanked = true;
          break;
        }

        // Check both text length and height, not just height: page may have enough text
        // but images/ads still loading growing height — height growth is not reason to wait.
        if (state.height === lastHeight && state.textLength === lastTextLength) stableRounds++;
        else stableRounds = 0;
        lastHeight = state.height;
        lastTextLength = state.textLength;

        const hasContent = state.textLength >= MIN_SETTLED_TEXT;

        // Only snapshot when text length has STOPPED GROWING. Snapshotting while text
        // is still arriving gives a truncated chapter, and saving a truncated chapter is
        // far worse than retrying — errors are visible, truncated chapters are not.
        if (hasContent && stableRounds >= 1 && state.textLength > snapshotTextLength) {
          snapshot = await page.content().catch(() => snapshot);
          snapshotTextLength = state.textLength;
        }

        if (hasContent && stableRounds >= 1 && Date.now() - start >= SETTLE_MIN_MS) break;

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(300);
      }

      // Page may still be blanked right now, so longer version is trustworthy —
      // blanked page has only the shell in page.content().
      const finalHtml = blanked ? "" : await page.content().catch(() => "");
      const html = finalHtml.length >= snapshot.length ? finalHtml : snapshot;

      if (html.length < MIN_RENDERED_HTML_LENGTH) {
        if (blanked) {
          throw new BlankedPageError(
            t("Page blanked before content could be read (temporary error, can retry): {url}", { url })
          );
        }
        throw new Error(t("Page loaded empty (temporary error, can retry): {url}", { url }));
      }
      return html;
    } finally {
      await context.close();
    }
  } finally {
    await releasePage();
  }
}
