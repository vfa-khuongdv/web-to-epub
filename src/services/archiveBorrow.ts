import { JSDOM } from "jsdom";
import { ContentBlock } from "../types";
import { ArchiveLoanError } from "./archiveErrors";
import { ArchiveRestrictedError, ArchiveTooManyPagesError } from "./archiveErrors";
import { ImportedBook, ImportedChapter, MAX_IMAGE_BYTES, StoreImage } from "./epubImport";
import { t } from "./lang";
import { MAX_PAGES, PAGES_PER_CHUNK } from "./pdfImport";
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

const GRANT_RENEW_WINDOW_MS = 10 * 60_000;
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

const loanEndedError = (id: string) =>
  new ArchiveLoanError(
    t("The archive.org loan ended while importing — run the import again: {url}", {
      url: `https://archive.org/details/${id}`,
    })
  );

const pageReadError = (page: number, id: string) =>
  new ArchiveLoanError(
    t("Could not read page {page} of this Internet Archive book: {url}", {
      page,
      url: `https://archive.org/details/${id}`,
    })
  );

function chapterTitle(from: number, to: number, total: number, fallback: string): string {
  return total <= PAGES_PER_CHUNK ? fallback : t("Pages {from}–{to}", { from, to });
}

async function grantLeaf(
  fetchImpl: typeof fetch,
  session: SiteSession,
  config: ReaderConfig,
  leafNum: number
): Promise<boolean> {
  const query = new URLSearchParams({
    id: config.bookId,
    subprefix: config.subPrefix,
    leafNum: String(leafNum),
  });
  const url = `https://archive.org/services/bookreader/request_page?${query}`;
  const response = await fetchImpl(url, { headers: siteSessionHeaders(session, url) });
  const body = (await response.json().catch(() => null)) as { success?: boolean; value?: number[] } | null;
  return !!response.ok && body?.success === true;
}

// One leaf's JPEG: grant the spread if needed, then read the page. Access that went
// away (expired loan) is renewed once and retried; a refusal that survives the retry
// means the loan is over, while a granted page that still will not read is a broken
// page — the two failures say different things to the reader (spec §3.4).
async function fetchLeaf(
  fetchImpl: typeof fetch,
  holder: { current: SiteSession },
  config: ReaderConfig,
  leaf: ReaderLeaf,
  granted: Set<number>
): Promise<Buffer> {
  let refused = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      holder.current = await renewLoan(fetchImpl, holder.current, config.bookId).catch(() => holder.current);
      granted.clear();
    }
    let grantedNow = granted.has(leaf.leafNum);
    if (!grantedNow) {
      grantedNow = await grantLeaf(fetchImpl, holder.current, config, leaf.leafNum);
      if (grantedNow) {
        // the grant covers this leaf and its spread partner (the API answers [n, n+1])
        granted.add(leaf.leafNum);
        granted.add(leaf.leafNum + 1);
      }
    }
    if (!grantedNow) {
      refused = true;
      continue;
    }
    refused = false;
    const response = await fetchImpl(leaf.uri, { headers: siteSessionHeaders(holder.current, leaf.uri) });
    // A real fetch follows the redirect to preview-unavailable (visible in response.url);
    // an unfollowed 302 (as in the test mocks) still carries it in Location.
    const location = response.headers.get("location") ?? "";
    const unavailable = response.url.includes("preview-unavailable") || location.includes("preview-unavailable");
    if (!response.ok || unavailable) {
      refused = unavailable || response.status === 401 || response.status === 403;
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length >= 3 && JPEG_MAGIC.every((byte, index) => bytes[index] === byte)) return bytes;
    refused = false;
  }
  if (refused) throw loanEndedError(config.bookId);
  throw pageReadError(leaf.leafNum, config.bookId);
}

export async function captureChapters(
  fetchImpl: typeof fetch,
  initialSession: SiteSession,
  config: ReaderConfig,
  storeImage: StoreImage,
  fallbackTitle: string
): Promise<ImportedChapter[]> {
  const leaves = [...config.leaves].sort((a, b) => a.leafNum - b.leafNum);
  if (leaves.length > MAX_PAGES) throw new ArchiveTooManyPagesError(MAX_PAGES);

  const holder = { current: initialSession };
  const granted = new Set<number>();
  const chapters: ImportedChapter[] = [];
  let current: ContentBlock[] | undefined;

  for (let index = 0; index < leaves.length; index++) {
    // Renew before the loan window runs out; the capture of a long book outlives it.
    const expiry = loanExpiryEpoch(holder.current, config.bookId);
    if (expiry && expiry * 1000 - Date.now() < GRANT_RENEW_WINDOW_MS) {
      holder.current = await renewLoan(fetchImpl, holder.current, config.bookId).catch(() => holder.current);
    }

    const leaf = leaves[index];
    if (index % PAGES_PER_CHUNK === 0) {
      current = [];
      chapters.push({
        title: chapterTitle(index + 1, Math.min(index + PAGES_PER_CHUNK, leaves.length), leaves.length, config.bookTitle || fallbackTitle),
        blocks: current,
      });
    }
    const bytes = await fetchLeaf(fetchImpl, holder, config, leaf, granted);
    if (bytes.length > MAX_IMAGE_BYTES) continue;
    current!.push({ type: "image", src: storeImage(bytes, "jpg"), alt: "" });
  }
  return chapters;
}

export async function importBorrowedBook(
  fetchImpl: typeof fetch,
  session: SiteSession,
  id: string,
  item: { title: string },
  storeImage: StoreImage
): Promise<ImportedBook> {
  const config = await readerConfig(fetchImpl, session, id);
  const lendable = config.lendingStatus.is_lendable;
  if (lendable === false || lendable === "false") {
    throw new ArchiveRestrictedError(`https://archive.org/details/${id}`);
  }
  const loan = await ensureLoan(fetchImpl, session, id, config.lendingStatus);
  try {
    const chapters = await captureChapters(fetchImpl, loan.session, config, storeImage, item.title);
    return { title: config.bookTitle || item.title, chapters };
  } finally {
    // Only a borrow this import started is handed back (spec §3.3); a browse expires
    // on its own and the reader's own loan is theirs to keep.
    if (loan.startedBorrow) await returnLoan(fetchImpl, loan.session, id);
  }
}
