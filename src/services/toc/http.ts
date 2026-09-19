import { t } from "../lang";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const JITTER_MS = 250;
// Connection errors (reset/timeout) are retried once: if the network blocks a host entirely,
// retrying 5 times like with 429 would make each chapter error cost tens of seconds.
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

// undici wraps network errors as TypeError("fetch failed") and puts the real code in `cause`.
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

// "fetch failed" tells users nothing; when a connection dies (e.g., ISP blocks a host or the site
// blocks your IP), say which host clearly and what to try next.
function networkFailureMessage(url: string, code: string): string {
  return t(
    "Failed to connect to {host} ({code}) — connection dropped before getting a response. If your network is blocking this site or the site is blocking your IP, try a VPN/proxy and run again. URL: {url}",
    { host: hostOf(url), code, url }
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Server Retry-After (in seconds) takes priority; without it, use exponential backoff + jitter
// to prevent multiple requests from coinciding.
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
  // Large files (audio/video embedded in EPUB) don't fit in the 15-second default timeout.
  timeoutMs?: number;
}

// Some sites hit Cloudflare rate limits (429) when bombarded with requests in succession —
// happened with xtruyen.vn's api-chapters.php when loading long stories. Retry with backoff
// instead of failing immediately; also retry 5xx since they're usually temporary.
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
    const hint = res.status === 429 ? t(" — page is rate-limiting access, try again in a few minutes") : "";
    throw new Error(t("Failed to fetch {url} (HTTP {status}){hint}", { url, status: res.status, hint }));
  }
  return res.text();
}
