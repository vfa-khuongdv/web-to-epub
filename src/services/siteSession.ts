import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import type { BrowserContextOptions } from "playwright";
import { DATA_DIR } from "../config/paths";
import { t } from "./lang";

// Saved browser sessions, one JSON file per site (Playwright storageState plus the user
// agent the session was captured with). The user creates one from a cURL copy of a
// request made in their own logged-in browser (the dialog in the UI, or scripts/); the
// app never handles the password and never solves a bot check. The file is as powerful as
// the account's cookies, so it lives next to the library with owner-only permissions.
export const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

type StorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;

export interface SiteSession extends StorageState {
  // The bot protection that issued the cookies bound them to the browser's user agent,
  // so renders for that site use the same one (see renderer.ts).
  userAgent?: string;
  // When the session was imported. The site's access tokens are short-lived (about an
  // hour), so the settings page shows this to explain why crawling stopped working.
  savedAt?: string;
}

export interface ParsedSiteSession {
  userAgent?: string;
  cookies: NonNullable<SiteSession["cookies"]>;
}

export function sessionHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function sessionFilePath(hostname: string): string {
  return path.join(SESSIONS_DIR, `${hostname}.json`);
}

function loadSessionByHostname(hostname: string): SiteSession | undefined {
  const file = sessionFilePath(hostname);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SiteSession;
  } catch {
    throw new Error(t("Saved login session is unreadable — delete {file} and log in again", { file }));
  }
}

/**
 * The logged-in browser state for the site a URL belongs to, or undefined for guests.
 * A file that exists but cannot be read is an error, not a silent fall back to guest:
 * the crawler would otherwise report "needs login" while the user believes they are
 * logged in.
 */
export function loadSiteSession(url: string): SiteSession | undefined {
  const hostname = sessionHostname(url);
  if (!hostname) return undefined;
  return loadSessionByHostname(hostname);
}

// The payload of a JWT cookie, or undefined for anything that is not one — the session
// also holds cookies like csrf_token and _ga.
function jwtPayload(value: string): Record<string, unknown> | undefined {
  const parts = value.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * When the saved login stops working: the earliest expiry among its JWT cookies. A site
 * hands out a long-lived refresh token and a short-lived access token, and it is the short
 * one that ends the session. Undefined when no cookie carries a readable expiry.
 */
export function sessionExpiresAt(session: SiteSession): string | undefined {
  const expiries = (session.cookies ?? [])
    .map((cookie) => {
      const exp = jwtPayload(cookie.value)?.exp;
      return typeof exp === "number" ? exp : undefined;
    })
    .filter((exp): exp is number => exp !== undefined);
  if (expiries.length === 0) return undefined;
  return new Date(Math.min(...expiries) * 1000).toISOString();
}

/**
 * The account the saved login belongs to, taken from the usual claims of its JWT cookies.
 * Display only — it is what the token itself says, which also makes it a check that the
 * pasted cURL came from the browser profile the reader meant to use.
 */
export function sessionAccountName(session: SiteSession): string | undefined {
  for (const cookie of session.cookies ?? []) {
    const payload = jwtPayload(cookie.value);
    if (!payload) continue;
    for (const claim of ["name", "preferred_username", "username", "nickname"]) {
      const value = payload[claim];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

// A corrupt file counts as "no session": the settings page offers Import again, which
// overwrites it, instead of showing a saved state the crawler cannot use.
export function siteSessionStatus(hostname: string): {
  configured: boolean;
  savedAt?: string;
  expiresAt?: string;
  username?: string;
} {
  try {
    const session = loadSessionByHostname(hostname);
    if (!session) return { configured: false };
    return {
      configured: true,
      savedAt: session.savedAt,
      expiresAt: sessionExpiresAt(session),
      username: sessionAccountName(session),
    };
  } catch {
    return { configured: false };
  }
}

function writeSessionFile(hostname: string, session: SiteSession): void {
  mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  const file = sessionFilePath(hostname);
  writeFileSync(file, JSON.stringify(session, null, 2));
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows has no POSIX permissions; the file is still under the user's profile.
  }
}

export function saveSiteSession(hostname: string, session: SiteSession): void {
  writeSessionFile(hostname, { ...session, savedAt: new Date().toISOString() });
}

/**
 * Cookies the site set while a page rendered, on top of the saved ones. Same
 * name+domain+path means the same cookie: the fresh value wins, everything else is kept.
 * Merged instead of replaced on purpose — a render served as guest (or one that failed
 * early) must never be able to wipe a working session.
 */
export function mergeSessionCookies(
  saved: NonNullable<SiteSession["cookies"]>,
  incoming: NonNullable<SiteSession["cookies"]>
): NonNullable<SiteSession["cookies"]> {
  const merged = [...saved];
  for (const cookie of incoming) {
    const at = merged.findIndex(
      (c) => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path
    );
    if (at >= 0) merged[at] = cookie;
    else merged.push(cookie);
  }
  return merged;
}

/**
 * Write cookies obtained during a render back into the saved session. Sites hand out a
 * short-lived access token and refresh it from the page's own scripts (AFF: an hour); a
 * throwaway browser context would drop the refreshed cookie, leaving the next render with
 * the snapshot the user pasted and the site serving a guest page. Best effort by design:
 * a render must not fail because the session file could not be updated.
 */
export function persistRenderedCookies(url: string, cookies: SiteSession["cookies"] | undefined): void {
  if (!cookies?.length) return;
  const hostname = sessionHostname(url);
  if (!hostname) return;
  const session = loadSessionByHostname(hostname);
  // No saved session: a guest render, and nothing that should create one.
  if (!session) return;
  // savedAt stays the import time: it explains the pasted snapshot, not the last render.
  writeSessionFile(hostname, { ...session, cookies: mergeSessionCookies(session.cookies ?? [], cookies) });
}

export function removeSiteSession(hostname: string): boolean {
  const file = sessionFilePath(hostname);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

// Chrome wraps long commands with "\" + newline; joining first keeps header parsing simple.
function curlHeader(curlText: string, name: string): string | undefined {
  const patterns = [
    new RegExp(`-H\\s+(['"])${name}:\\s*([\\s\\S]*?)\\1`, "i"),
    new RegExp(`--header\\s+(['"])${name}:\\s*([\\s\\S]*?)\\1`, "i"),
  ];
  for (const re of patterns) {
    const match = curlText.match(re);
    if (match) return match[match.length - 1].trim();
  }
  return undefined;
}

// Some browsers' "Copy as cURL" puts cookies in -b/--cookie instead of a Cookie header.
function curlCookieFlag(curlText: string): string | undefined {
  const match = curlText.match(/(?:^|\s)(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/i);
  return match?.[2]?.trim();
}

/**
 * Turn a "Copy as cURL" from the user's own browser into a session. Throws messages the
 * dialog shows verbatim, so each one says what to paste instead.
 */
export function parseSessionCurl(curlText: string, domain: string): ParsedSiteSession {
  const input = curlText.trim().replace(/\\\r?\n/g, " ");
  if (!input) throw new Error(t("Paste the cURL copy from your browser first"));

  const urlMatch = input.match(/curl\s+(['"])(https?:\/\/[^'"]+)\1/i) ?? input.match(/(https?:\/\/[^\s'"]+)/);
  const pageUrl = urlMatch?.[2] ?? urlMatch?.[1];
  let hostname: string;
  try {
    hostname = new URL(pageUrl ?? "").hostname.toLowerCase();
  } catch {
    throw new Error(t("Could not find a URL in the pasted cURL"));
  }
  if (hostname !== domain && !hostname.endsWith(`.${domain}`)) {
    throw new Error(t("That cURL is not for {domain} — copy a request from the site while logged in", { domain }));
  }

  const cookieHeader = curlHeader(input, "cookie") ?? curlCookieFlag(input);
  if (!cookieHeader) {
    throw new Error(t("No cookies found in that cURL — copy a request from the site while logged in"));
  }
  const cookies = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .flatMap((part) => {
      const eq = part.indexOf("=");
      if (eq <= 0) return [];
      return [
        {
          name: part.slice(0, eq).trim(),
          value: part.slice(eq + 1).trim(),
          domain: `.${domain}`,
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax" as const,
        },
      ];
    })
    .filter((cookie) => cookie.name.length > 0);
  if (cookies.length === 0) {
    throw new Error(t("No cookies found in that cURL — copy a request from the site while logged in"));
  }

  return { userAgent: curlHeader(input, "user-agent"), cookies };
}
