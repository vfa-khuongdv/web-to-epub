const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const JITTER_MS = 250;
// Lỗi kết nối (reset/timeout) chỉ thử lại một lần: nếu mạng chặn hẳn một host
// thì retry 5 lần như với 429 sẽ khiến mỗi chương lỗi tốn hàng chục giây.
const NETWORK_ATTEMPTS = 2;

const RETRIABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "TimeoutError",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_ABORTED",
]);

// undici gói lỗi mạng thành TypeError("fetch failed") và để mã thật ở `cause`.
export function networkErrorCode(err: unknown): string | undefined {
  const cause = (err as { cause?: unknown } | null)?.cause ?? err;
  const code = (cause as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TimeoutError" ? name : undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// "fetch failed" không nói được gì cho người dùng; khi kết nối bị ngắt (ví dụ
// nhà mạng chặn host, hoặc site chặn IP) thì phải nói rõ host nào và thử gì tiếp.
function networkFailureMessage(url: string, code: string): string {
  return `Không kết nối được tới ${hostOf(url)} (${code}) — kết nối bị ngắt trước khi có phản hồi. Nếu mạng đang chặn site này hoặc site chặn IP của bạn, hãy thử VPN/proxy rồi chạy lại. URL: ${url}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry-After (giây) của server được ưu tiên; nếu không có thì backoff luỹ
// thừa + jitter để nhiều request không dồn lại cùng lúc.
export function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSec) && retryAfterSec >= 0) {
    return Math.min(retryAfterSec * 1000, MAX_DELAY_MS);
  }
  const backoff = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return backoff + Math.floor(Math.random() * JITTER_MS);
}

interface FetchWithRetryOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  // Tải file lớn (audio/video nhúng vào EPUB) không xong trong 15 giây mặc định.
  timeoutMs?: number;
}

// Các site bị Cloudflare giới hạn tần suất (429) khi bị bắn nhiều request
// liên tiếp — đã gặp thật với api-chapters.php của xtruyen.vn khi load truyện
// dài. Retry với backoff thay vì fail ngay; 5xx cũng retry vì thường tạm thời.
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const code = networkErrorCode(err);
      if (code && RETRIABLE_NETWORK_CODES.has(code) && attempt < NETWORK_ATTEMPTS) {
        await sleepImpl(retryDelayMs(attempt, null));
        continue;
      }
      throw err;
    }
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= maxAttempts) return res;
    await sleepImpl(retryDelayMs(attempt, res.headers.get("retry-after")));
  }
}

export async function fetchText(url: string, init: RequestInit = {}, options: FetchWithRetryOptions = {}): Promise<string> {
  let res: Response;
  try {
    res = await fetchWithRetry(url, init, options);
  } catch (err) {
    const code = networkErrorCode(err);
    if (!code) throw err;
    throw new Error(networkFailureMessage(url, code));
  }
  if (!res.ok) {
    const hint = res.status === 429 ? " — trang đang giới hạn tần suất truy cập, thử lại sau ít phút" : "";
    throw new Error(`Không tải được ${url} (HTTP ${res.status})${hint}`);
  }
  return res.text();
}
