import { t } from "./lang";
import { loadSiteSession } from "./siteSession";

// Cloudflare's interstitial, in the languages the sites in this app serve it in ("Chờ
// một chút..." on Vietnamese sites, "Just a moment..." elsewhere). It replaces the
// requested page while the check runs, so its markers are what tells a failed fetch
// apart from a real page.
const CHALLENGE_RE =
  /just a moment|chờ một chút|performing security verification|xác minh bảo mật|security service to protect|enable javascript and cookies to continue/i;

export function isCloudflareChallenge(html: string): boolean {
  return CHALLENGE_RE.test(html);
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
