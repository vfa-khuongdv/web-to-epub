// Internet Archive book import: the add box recognises an item URL so it can import
// instead of asking for a chapter list. The server re-checks the host — this is UX only.
const ITEM_PATH_RE = /^\/(?:details|metadata|download)\/([^/?#]+)/;

export function archiveItemId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== "archive.org") return undefined;
  const match = ITEM_PATH_RE.exec(parsed.pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function isArchiveItemUrl(url: string): boolean {
  return archiveItemId(url) !== undefined;
}
