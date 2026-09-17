const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const JITTER_MS = 250;

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

  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= maxAttempts) return res;
    await sleepImpl(retryDelayMs(attempt, res.headers.get("retry-after")));
  }
}

export async function fetchText(url: string, init: RequestInit = {}, options: FetchWithRetryOptions = {}): Promise<string> {
  const res = await fetchWithRetry(url, init, options);
  if (!res.ok) {
    const hint = res.status === 429 ? " — trang đang giới hạn tần suất truy cập, thử lại sau ít phút" : "";
    throw new Error(`Không tải được ${url} (HTTP ${res.status})${hint}`);
  }
  return res.text();
}
