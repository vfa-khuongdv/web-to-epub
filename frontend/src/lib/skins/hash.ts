// FNV-1a: a small, stable string hash, so the made-up details of a skin (names, sizes,
// commit ids, colours) stay the same for the same story on every visit.
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
