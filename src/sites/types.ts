import type { ChapterFetcher } from "../services/chapters/types";
import type { TocAdapter } from "../services/toc/types";

export interface SupportedSite {
  domain: string;
  name: string;
}

// A saved browser session (Settings → Site sessions). `slug` is the public name in
// /api/site-sessions/:slug; a slug allowlist rather than a domain parameter, so no
// request can name a file to write.
export interface SiteSessionInfo {
  slug: string;
  domain: string;
}

/**
 * Everything one site contributes, declared in its own folder (src/sites/<id>/index.ts)
 * and listed once in src/sites/index.ts. The allowlist, the TOC/chapter dispatch and the
 * session slugs are all derived from these, so adding a site touches no shared file but
 * that list (plus i18n and the frontend copy for a session, if it needs one).
 */
export interface SiteModule {
  id: string;
  // Rows of the crawl allowlist, in the order the add box shows them. This is the trust
  // boundary: a URL is only crawled when one of these matches (subdomains included).
  supported?: SupportedSite[];
  // Book-file sources that are imported, never crawled — kept apart from `supported` on
  // purpose (findSupportedSite trusts only that list).
  imports?: SupportedSite[];
  // Chapter list of a story URL. Matched on the exact hostname (www. stripped).
  toc?: TocAdapter;
  // Direct chapter fetch; without it the shared renderer + extractor reads the page.
  chapter?: ChapterFetcher;
  session?: SiteSessionInfo;
}
