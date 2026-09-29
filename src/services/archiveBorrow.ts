import { JSDOM } from "jsdom";
import { ArchiveLoanError } from "./archiveErrors";
import { t } from "./lang";
import { mergeSessionCookies, SiteSession, siteSessionHeaders } from "./siteSession";

/**
 * The reader's own endpoints for a borrow-only item, driven with the session the
 * reader saved from their browser. Files stay private and LCP stays encrypted —
 * only what the BookReader itself displays (page images) is captured, so the book
 * lands as image blocks, like a scanned PDF. Endpoints are pinned by
 * docs/superpowers/specs/2026-09-29-archive-borrow-import-design.md §2.
 */

export interface ReaderLeaf {
  leafNum: number;
  uri: string;
}

export interface ReaderConfig {
  bookId: string;
  subPrefix: string;
  bookTitle: string;
  leaves: ReaderLeaf[];
  lendingStatus: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export async function readerConfig(fetchImpl: typeof fetch, session: SiteSession, id: string): Promise<ReaderConfig> {
  const detailsUrl = `https://archive.org/details/${encodeURIComponent(id)}`;
  const details = await fetchImpl(detailsUrl, { headers: siteSessionHeaders(session, detailsUrl) });
  if (!details.ok) throw new Error(`archive details request failed (${details.status})`);
  const html = await details.text();
  const input = new JSDOM(html).window.document.querySelector("input.js-bookreader") as
    | (Element & { value?: string })
    | null;
  let configUrl: string | undefined;
  if (input?.value) {
    try {
      const parsed = JSON.parse(input.value) as { url?: unknown };
      if (typeof parsed.url === "string" && parsed.url) {
        configUrl = parsed.url.startsWith("//") ? `https:${parsed.url}` : parsed.url;
      }
    } catch {
      configUrl = undefined;
    }
  }
  if (!configUrl) throw new Error("archive reader config not found on the details page");

  // The endpoint lives on the storage host and only answers format=json there.
  const jsonUrl = configUrl.replace("format=jsonp", "format=json");
  const response = await fetchImpl(jsonUrl, { headers: siteSessionHeaders(session, jsonUrl) });
  if (!response.ok) throw new Error(`archive reader config request failed (${response.status})`);
  const body = (await response.json().catch(() => null)) as {
    data?: {
      brOptions?: { bookId?: unknown; subPrefix?: unknown; bookTitle?: unknown; data?: unknown };
      lendingInfo?: { lendingStatus?: unknown };
      metadata?: unknown;
    };
  } | null;
  const brOptions = body?.data?.brOptions;
  if (!brOptions || !Array.isArray(brOptions.data)) throw new Error("archive reader config has an unexpected shape");

  const leaves: ReaderLeaf[] = [];
  for (const group of brOptions.data) {
    if (!Array.isArray(group)) continue;
    for (const leaf of group) {
      if (leaf && typeof leaf.leafNum === "number" && typeof leaf.uri === "string") {
        leaves.push({ leafNum: leaf.leafNum, uri: leaf.uri });
      }
    }
  }
  const lendingStatus = (body?.data?.lendingInfo?.lendingStatus ?? {}) as Record<string, unknown>;
  return {
    bookId: typeof brOptions.bookId === "string" ? brOptions.bookId : id,
    subPrefix: typeof brOptions.subPrefix === "string" ? brOptions.subPrefix : id,
    bookTitle: typeof brOptions.bookTitle === "string" ? brOptions.bookTitle : "",
    leaves,
    lendingStatus,
    metadata: (body?.data?.metadata ?? {}) as Record<string, unknown>,
  };
}

const truthy = (value: unknown): boolean => value === true || value === "true";

// The loan cookie carries its own expiry: loan-<id> = <epoch>-<signature>.
export function loanExpiryEpoch(session: SiteSession, id: string): number | undefined {
  const cookie = (session.cookies ?? []).find((candidate) => candidate.name === `loan-${id}`);
  const epoch = Number(cookie?.value.split("-")[0]);
  return Number.isFinite(epoch) && epoch > 0 ? epoch : undefined;
}

// Cookies the loans API sets, as storage-state cookies. Attributes are best effort:
// only name/value/domain/path reach the request headers.
function setCookieCookies(response: Response, fallbackDomain: string): NonNullable<SiteSession["cookies"]> {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies: NonNullable<SiteSession["cookies"]> = [];
  for (const raw of headers.getSetCookie?.() ?? []) {
    const [pair = ""] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!name) continue;
    const domain = (/domain=([^;]+)/i.exec(raw)?.[1] ?? fallbackDomain).trim().replace(/^\./, "");
    const cookiePath = /path=([^;]+)/i.exec(raw)?.[1]?.trim() ?? "/";
    cookies.push({
      name,
      value: pair.slice(eq + 1).trim(),
      domain,
      path: cookiePath,
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    });
  }
  return cookies;
}

async function postLoan(
  fetchImpl: typeof fetch,
  session: SiteSession,
  id: string,
  action: "browse_book" | "borrow_book" | "renew_loan" | "return_loan"
): Promise<SiteSession> {
  const url = "https://archive.org/services/loans/loan";
  const form = new FormData();
  form.append("action", action);
  form.append("identifier", id);
  const response = await fetchImpl(url, { method: "POST", body: form, headers: siteSessionHeaders(session, url) });
  const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
  // The API answers { error } on failure; anything unreadable (a login page, a 5xx)
  // means this session cannot act on the loan.
  if (!response.ok || !body || body.error) {
    throw new ArchiveLoanError(
      t("The saved archive.org session is not logged in — import a fresh one (Settings → Site sessions).")
    );
  }
  const fresh = setCookieCookies(response, "archive.org");
  return fresh.length ? { ...session, cookies: mergeSessionCookies(session.cookies ?? [], fresh) } : session;
}

/**
 * Make sure a loan is active for the capture: reuse the reader's own session when
 * one is running, otherwise start one (a borrow when a copy allows it, else the
 * one-hour browse). `session` is the one to capture with — the loan's own cookies
 * are merged in, because this POST's Set-Cookie is what grants access.
 * `startedBorrow` is true only when this call posted `borrow_book`, so the caller
 * can return it when it is done (spec §3.3).
 */
export async function ensureLoan(
  fetchImpl: typeof fetch,
  session: SiteSession,
  id: string,
  lendingStatus: Record<string, unknown>
): Promise<{ session: SiteSession; startedBorrow: boolean }> {
  const active = Number(lendingStatus.active_borrows ?? 0) > 0 || Number(lendingStatus.active_browses ?? 0) > 0;
  if (active) return { session, startedBorrow: false };
  const canBorrow = truthy(lendingStatus.available_to_borrow);
  const canBrowse = truthy(lendingStatus.available_to_browse);
  if (!canBorrow && !canBrowse) {
    throw new ArchiveLoanError(
      t("No copy of this Internet Archive book is available to borrow right now — try again later: {url}", {
        url: `https://archive.org/details/${id}`,
      })
    );
  }
  const next = await postLoan(fetchImpl, session, id, canBorrow ? "borrow_book" : "browse_book");
  return { session: next, startedBorrow: canBorrow };
}

export async function renewLoan(fetchImpl: typeof fetch, session: SiteSession, id: string): Promise<SiteSession> {
  return postLoan(fetchImpl, session, id, "renew_loan");
}

// Best effort: a loan that cannot be returned still expires on IA's own clock.
export async function returnLoan(fetchImpl: typeof fetch, session: SiteSession, id: string): Promise<void> {
  await postLoan(fetchImpl, session, id, "return_loan").catch(() => undefined);
}
