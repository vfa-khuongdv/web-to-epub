import { SupportedSite } from "../types";

export function isSupportedUrl(url: string, sites: SupportedSite[]): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return sites.some((site) => hostname === site.domain || hostname.endsWith(`.${site.domain}`));
}
