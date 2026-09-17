import { Browser, chromium } from "playwright";

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Some sites ship an anti-tool script that blanks the document (and then
// navigates to about:blank) at random moments — it misfires against a
// headless browser. When that happens the page cannot be captured, so the
// renderer gives up quickly with an error the caller can retry (see
// extractWithRetry in routes/api.ts), instead of lingering and reporting a
// misleading extraction failure. Capture happens as soon as the content has
// settled, which wins the race against the wipe on most loads.
const SETTLE_MIN_MS = 1000;
const SETTLE_MAX_MS = 6000;
const MIN_RENDERED_HTML_LENGTH = 1500;

type PageState = { blanked: boolean; height: number; textLength: number };

/**
 * Renders a URL like a real browser (executes JS/CSS) and returns the fully
 * rendered DOM as serialized HTML. Since this reads page.content() directly
 * from the DOM tree rather than going through the browser's selection/
 * clipboard pipeline, CSS `user-select: none`, `oncopy`/`oncontextmenu`
 * handlers and similar copy-blocking scripts have no effect on it.
 */
export async function renderPageHtml(url: string): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: BROWSER_USER_AGENT });
  const page = await context.newPage();
  try {
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
    let stableRounds = 0;
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
        throw new Error(`Trang bị xoá trắng trong lúc tải (lỗi tạm thời, thử lại được): ${url}`);
      }

      if (state.height === lastHeight) stableRounds++;
      else {
        stableRounds = 0;
        lastHeight = state.height;
      }

      const hasContent = state.textLength > 3000;
      if (hasContent && stableRounds >= 1 && Date.now() - start >= SETTLE_MIN_MS) break;

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(300);
    }

    const html = await page.content();
    if (html.length < MIN_RENDERED_HTML_LENGTH) {
      throw new Error(`Trang tải về rỗng (lỗi tạm thời, thử lại được): ${url}`);
    }
    return html;
  } finally {
    await context.close();
  }
}
