import { archive } from "./archive";
import { asianfanfics } from "./asianfanfics";
import { docln } from "./docln";
import { dtvebook } from "./dtvebook";
import { fanfiction } from "./fanfiction";
import { heyzine } from "./heyzine";
import { royalroad } from "./royalroad";
import { scribd } from "./scribd";
import { truyenfull } from "./truyenfull";
import type { SiteModule, SupportedSite } from "./types";
import { vietmessenger } from "./vietmessenger";
import { wattpad } from "./wattpad";
import { xtruyen } from "./xtruyen";
import type { ChapterFetcher } from "../services/chapters/types";
import type { TocAdapter } from "../services/toc/types";

export type { SiteModule, SupportedSite } from "./types";

// The one place a new site is registered. The order is the order the add box lists them.
export const SITES: SiteModule[] = [
  xtruyen,
  truyenfull,
  wattpad,
  asianfanfics,
  fanfiction,
  vietmessenger,
  scribd,
  archive,
  dtvebook,
  heyzine,
  royalroad,
  docln,
];

export const SUPPORTED_SITES: SupportedSite[] = SITES.flatMap((site) => site.supported ?? []);
export const IMPORT_SOURCES: SupportedSite[] = SITES.flatMap((site) => site.imports ?? []);

// slug -> domain of every site that can keep a saved browser session.
export const SESSION_SITES: Record<string, string> = Object.fromEntries(
  SITES.flatMap((site) => (site.session ? [[site.session.slug, site.session.domain]] : []))
);

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function getTocAdapter(url: string): TocAdapter | undefined {
  const hostname = hostnameOf(url);
  if (!hostname) return undefined;
  return SITES.find((site) => site.toc?.domains.includes(hostname))?.toc;
}

export function getChapterFetcher(url: string): ChapterFetcher | undefined {
  const hostname = hostnameOf(url);
  if (!hostname) return undefined;
  return SITES.find((site) => site.chapter?.domains.includes(hostname))?.chapter;
}
