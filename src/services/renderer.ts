import { Browser, chromium } from "playwright";
import browserConfig from "../config/browser.json";
import { t } from "./lang";
import { loadSiteSession, persistRenderedCookies } from "./siteSession";

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

// Shared with scripts/site-login.mjs (src/config/browser.json): the session captured at
// login is bound by the site's bot protection to this user agent and the machine's IP,
// so rendering has to use the same one or the site treats it as a different client.
const BROWSER_USER_AGENT = browserConfig.userAgent;

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
    // Sites the user has logged into by hand (scripts/aff-session.mjs) render with the
    // saved session, so content behind that account is read the way the reader sees it.
    // The session carries the user agent it was captured with, because the site's bot
    // protection binds its cookies to it.
    const session = loadSiteSession(url);
    const context = await browser.newContext({
      userAgent: session?.userAgent ?? BROWSER_USER_AGENT,
      storageState: session ? { cookies: session.cookies, origins: session.origins } : undefined,
    });
    try {
      const page = await context.newPage();
      // "networkidle" is unreliable in practice: sites with continuous
      // background traffic (ads, analytics beacons, chat widgets) never reach
      // it and the navigation just times out, even though the actual chapter
      // content rendered almost immediately. "domcontentloaded" plus the
      // bounded settle loop below is faster and more robust across sites.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

      // Asianfanfics gates every page behind an "Are you over 18?" click-through that is
      // independent of login: it sets a cookie only when a real click happens (a plain
      // request to the same href does not), so a session captured from a pasted cURL never
      // carries it. Click it once per render so rendering behaves like an already-verified
      // browser, same as the user's own.
      if (/(^|\.)asianfanfics\.com$/.test(new URL(url).hostname)) {
        const ageGate = page.locator('a[href="/htmx/story/verify_age"]');
        if (await ageGate.count().catch(() => 0)) {
          await ageGate.first().click().catch(() => {});
          // The click reloads the page; without this the settle loop below starts
          // polling mid-navigation and reads a transient blank document as a real
          // BlankedPageError instead of waiting for the unlocked content.
          await page.waitForLoadState("domcontentloaded").catch(() => {});
        }
      }

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
      // The site's own scripts refresh its short-lived login token while the page runs;
      // keep those cookies, or the next render starts from the pasted snapshot and the
      // site serves a guest page again. Never allowed to fail the render.
      if (session) {
        try {
          persistRenderedCookies(url, (await context.storageState()).cookies);
        } catch {
          // Best effort: the session file is a cache of the login, not part of the render.
        }
      }
      await context.close();
    }
  } finally {
    await releasePage();
  }
}
