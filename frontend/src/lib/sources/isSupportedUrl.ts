import { SupportedSite } from "../../types";

// `mode` narrows the list: pass "crawl" to ask "can this URL be crawled?", which the add
// box must, since a URL from an import source has no chapter list to load. Omit it to ask
// the wider question "is this domain supported at all?", which is what the error message
// and the site popover show.
export function isSupportedUrl(
  url: string,
  sites: SupportedSite[],
  mode?: SupportedSite["mode"]
): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return sites.some(
    (site) =>
      (!mode || site.mode === mode) && (hostname === site.domain || hostname.endsWith(`.${site.domain}`))
  );
}
