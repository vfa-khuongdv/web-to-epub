import { Browser, chromium } from "playwright";

let browserPromise: Promise<Browser> | null = null;

// Bộ nhớ của tiến trình Chromium phình dần theo số trang đã mở, mà crawl vài
// trăm chương (cộng các lần thử lại) dồn hàng nghìn lần tải vào đúng một tiến
// trình. Thay browser mới sau mỗi ngần này lần tải để trả lại phần đã phình —
// đừng hạ quá thấp: lần tải đầu trên browser mới đo được ~4.7s (cold start).
const RENDERS_PER_BROWSER = 500;
// Crawl xong thì không giữ Chromium sống chỉ để ngồi chiếm RAM.
const IDLE_CLOSE_MS = 60_000;

let rendersOnBrowser = 0;
// Số trang đang mở: chỉ được thay/đóng browser khi không còn trang nào, nếu
// không lần crawl song song bên cạnh sẽ bị đóng browser ngay giữa chừng.
let openPages = 0;
let idleTimer: NodeJS.Timeout | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    // Sandbox của Chromium cần user namespace — không có trong container nên
    // ảnh Docker bật CHROMIUM_NO_SANDBOX=1; chạy local vẫn giữ sandbox.
    const args = process.env.CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];
    // Launch hỏng thì bỏ luôn promise: giữ lại một promise đã reject nghĩa là
    // mọi chương sau đều hỏng theo, không bao giờ thử mở lại.
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
  // Bỏ tham chiếu trước khi await: trang gọi tới trong lúc đóng phải mở
  // browser mới chứ không dùng lại cái đang đóng.
  browserPromise = null;
  rendersOnBrowser = 0;
  try {
    await (await closing).close();
  } catch {
    // Browser đã chết sẵn thì coi như đóng xong.
  }
}

function armIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (openPages === 0) void closeBrowser();
  }, IDLE_CLOSE_MS);
  // Bộ đếm này không được giữ tiến trình sống.
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

// Some sites ship an anti-tool script that blanks the document (and then
// navigates to about:blank) at random moments — it misfires against a
// headless browser. Đo trên xtruyen: nội dung về đủ ở ~2.4s rồi bị xoá ở ~4.6s,
// tức là HTML hợp lệ đã nằm trong tay trước khi trang bị xoá. Nên vòng settle
// chụp lại bản tốt nhất nó thấy được; trang bị xoá thì dùng bản chụp đó thay vì
// bỏ cả lượt tải và thử lại. Chỉ khi chưa kịp chụp được gì mới báo lỗi cho
// extractWithRetry thử lại.
const SETTLE_MIN_MS = 500;
const SETTLE_MAX_MS = 6000;
const MIN_RENDERED_HTML_LENGTH = 1500;
// Đủ chữ để tin là nội dung đã tới, chứ không phải cái vỏ trang. Ngưỡng cũ là
// 3000 ký tự tuyệt đối, nên chương ngắn không bao giờ thoát sớm được và luôn
// đốt trọn SETTLE_MAX_MS dù nội dung đã đứng yên từ lâu.
const MIN_SETTLED_TEXT = 500;

type PageState = { blanked: boolean; height: number; textLength: number };

/**
 * Trang bị script chống tool xoá trắng trước khi đọc kịp nội dung. Đây là lỗi
 * ngẫu nhiên theo từng lượt tải, không phải site chặn mình, nên bên gọi thử lại
 * được ngay mà không cần chờ backoff (xem extractWithRetry).
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
  // Đếm trước khi await: giữa lúc chờ browser và lúc mở trang, luồng khác
  // không được coi là rảnh rồi thay/đóng browser ngay dưới chân mình.
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
      // Bản chụp nhiều chữ nhất từng thấy, giữ để cứu lượt tải bị xoá trắng.
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

        // Xét cả lượng chữ chứ không chỉ chiều cao: trang đã đủ chữ mà vẫn còn
        // ảnh/quảng cáo nong chiều cao thì không phải lý do để chờ tiếp.
        if (state.height === lastHeight && state.textLength === lastTextLength) stableRounds++;
        else stableRounds = 0;
        lastHeight = state.height;
        lastTextLength = state.textLength;

        const hasContent = state.textLength >= MIN_SETTLED_TEXT;

        // Chỉ chụp khi lượng chữ đã NGỪNG TĂNG. Chụp lúc chữ còn đang về sẽ cho
        // một chương cụt, mà chương cụt lưu vào sách thì tệ hơn hẳn một lần thử
        // lại — lỗi thì còn nhìn thấy, chương cụt thì không.
        if (hasContent && stableRounds >= 1 && state.textLength > snapshotTextLength) {
          snapshot = await page.content().catch(() => snapshot);
          snapshotTextLength = state.textLength;
        }

        if (hasContent && stableRounds >= 1 && Date.now() - start >= SETTLE_MIN_MS) break;

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(300);
      }

      // Trang vẫn có thể bị xoá đúng giữa lúc này, nên bản dài hơn mới là bản
      // đáng tin — trang đã xoá thì page.content() chỉ còn cái vỏ.
      const finalHtml = blanked ? "" : await page.content().catch(() => "");
      const html = finalHtml.length >= snapshot.length ? finalHtml : snapshot;

      if (html.length < MIN_RENDERED_HTML_LENGTH) {
        if (blanked) {
          throw new BlankedPageError(
            `Trang bị xoá trắng trước khi kịp đọc nội dung (lỗi tạm thời, thử lại được): ${url}`
          );
        }
        throw new Error(`Trang tải về rỗng (lỗi tạm thời, thử lại được): ${url}`);
      }
      return html;
    } finally {
      await context.close();
    }
  } finally {
    await releasePage();
  }
}
