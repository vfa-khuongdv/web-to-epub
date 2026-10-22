import { t } from "./lang";
import { loadSiteSession } from "./siteSession";

// Cloudflare's interstitial, in the languages the sites in this app serve it in ("Chờ
// một chút..." on Vietnamese sites, "Just a moment..." elsewhere). It replaces the
// requested page while the check runs, so its title is what tells a failed fetch apart
// from a real page. Only the title: chapter text says "Chờ một chút" all the time, and
// matching the whole page turned every such chapter into a "Cloudflare blocked" error.
const CHALLENGE_RE =
  /just a moment|chờ một chút|performing security verification|xác minh bảo mật|security service to protect|enable javascript and cookies to continue/i;

export function isCloudflareChallenge(html: string): boolean {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "";
  return CHALLENGE_RE.test(title);
}

/**
 * What the reader can do about a Cloudflare check that did not clear. The app never
 * solves one itself — the way through is their own browser, saved as a site session
 * (see siteSession.ts).
 */
export function cloudflareBlockedMessage(url: string, sessionSaved: boolean): string {
  return sessionSaved
    ? t(
        "Saved session is no longer accepted by Cloudflare — open the page in your browser, then re-import the session in Settings → Site sessions: {url}",
        { url }
      )
    : t(
        "This site is behind a Cloudflare check the app cannot pass on its own — open the page in your browser, then import a session in Settings → Site sessions and retry: {url}",
        { url }
      );
}

/** Cloudflare says so itself in a header, whatever the page body or status looks like. */
export function isCloudflareResponse(res: Response): boolean {
  return res.headers.get("cf-mitigated") === "challenge";
}

/** An import-only site (no saved-session slug) that Cloudflare stands in front of. */
export class CloudflareBlockedError extends Error {
  constructor(url: string) {
    super(
      t(
        "This site is behind a Cloudflare check the app cannot pass — download the file in your browser and import it with Import EPUB / PDF instead: {url}",
        { url }
      )
    );
  }
}
