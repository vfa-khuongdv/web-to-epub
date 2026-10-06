import { vaultQuery } from "../../vault/token";

// Where a story's cover <img> loads from: a saved cover is served by the app; one never downloaded still has its
// original address. An <img> cannot send headers, so a private cover carries the token in the query string.
export function coverSrc(storyId: string, coverUrl?: string): string | undefined {
  if (!coverUrl) return undefined;
  return coverUrl.startsWith("http")
    ? coverUrl
    : `/api/stories/${encodeURIComponent(storyId)}/cover?v=${encodeURIComponent(coverUrl)}${vaultQuery()}`;
}
