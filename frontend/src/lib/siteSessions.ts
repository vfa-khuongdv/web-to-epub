/**
 * Sites whose crawls need a session saved from the reader's own browser (see
 * src/services/siteSession.ts). Asianfanfics needs a login for rated-M and
 * subscribers-only stories; truyenfull.live pages sit behind a Cloudflare check the app
 * cannot pass by itself, so it reuses the pass the reader's browser already has.
 *
 * The dialog copy lives here as i18n keys — the English source text, translated by
 * `t()` where it is rendered.
 */
export interface SessionSite {
  slug: string;
  domain: string;
  // Brand name, shown as-is.
  label: string;
  dialogTitle: string;
  dialogIntro: string;
  dialogSteps: string[];
  dialogNotes: string[];
  placeholder: string;
  settingsConfiguredHint: string;
  settingsEmptyHint: string;
  skipNote: string;
  // Where the saved login's account name links to, when the site has profiles.
  accountUrl?: (username: string) => string;
  // Asianfanfics' token carries a readable expiry (about an hour); Cloudflare's
  // cf_clearance does not say when it dies, so truyenfull only shows when it was saved.
  showsExpiry: boolean;
}

export const SESSION_SITES: SessionSite[] = [
  {
    slug: "asianfanfics",
    domain: "asianfanfics.com",
    label: "Asianfanfics",
    dialogTitle: "Asianfanfics session",
    dialogIntro:
      "Rated-M and subscribers-only stories need a login saved from your own browser. The tool never sees your password — you log in there and paste a copy of the request.",
    dialogSteps: [
      "Log in to asianfanfics.com in your browser — the copy has to come from a page where you are already logged in.",
      "Open DevTools: press F12, or ⌥⌘I on a Mac (Safari: turn the Develop menu on first).",
      "Switch to the Network tab and reload the page (⌘R / Ctrl+R) so the request list fills up.",
      'Right-click the first request (the asianfanfics.com page) → Copy → Copy as cURL. "Copy as cURL (bash)" works too.',
      "Paste it into the box below and save.",
    ],
    dialogNotes: [
      "A wrong request (an image, an ad) carries no login cookies — the app says so instead of saving it.",
      "The saved login lasts about an hour; import a fresh one when it expires.",
      'For rated-M stories, turn off Settings → Content filter → "Filter mature content" on asianfanfics.com.',
    ],
    placeholder: "curl 'https://www.asianfanfics.com/story/view/123' -H 'cookie: ...'",
    settingsConfiguredHint: "A saved login is in use for rated-M and subscribers-only stories.",
    settingsEmptyHint: "Rated-M and subscribers-only stories need a login saved from your own browser.",
    skipNote: "You can skip this — public stories still load.",
    accountUrl: (username) => `https://www.asianfanfics.com/profile/u/${encodeURIComponent(username)}`,
    showsExpiry: true,
  },
  {
    slug: "truyenfull",
    domain: "truyenfull.live",
    label: "TruyenFull",
    dialogTitle: "TruyenFull session",
    dialogIntro:
      "TruyenFull checks every browser with Cloudflare before showing a story, and the app cannot pass that check on its own — it reuses the pass your browser already has. No password is involved.",
    dialogSteps: [
      "Open truyenfull.live in your browser and let the security check finish.",
      "Open DevTools: press F12, or ⌥⌘I on a Mac (Safari: turn the Develop menu on first).",
      "Switch to the Network tab and reload the page (⌘R / Ctrl+R) so the request list fills up.",
      'Right-click the first request (the truyenfull.live page) → Copy → Copy as cURL. "Copy as cURL (bash)" works too.',
      "Paste it into the box below and save.",
    ],
    dialogNotes: [
      "The pass is tied to this browser and network and usually lasts about half an hour — import a fresh one when crawls start getting blocked again.",
      "Copy the request from a story or chapter page that already loaded — a blocked page carries no pass.",
    ],
    placeholder: "curl 'https://truyenfull.live/…' -H 'cookie: cf_clearance=…'",
    settingsConfiguredHint: "A saved browser session is in use to pass TruyenFull's Cloudflare check.",
    settingsEmptyHint: "TruyenFull needs a saved browser session to pass its Cloudflare check.",
    skipNote: "Skipping means adding a TruyenFull story will fail while the site blocks the app.",
    showsExpiry: false,
  },
];

export function sessionSiteForUrl(url: string): SessionSite | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return SESSION_SITES.find((site) => hostname === site.domain || hostname.endsWith(`.${site.domain}`));
}
