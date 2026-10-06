// What the disguise skins print from a crawl: its log and its errors, never a story site's
// address (it names the site and, in its path, the story).

// A story site's address is the one thing a disguise must never print: it names the
// site and, in its path, the story.
export function stripUrls(text: string): string {
  // Sentence punctuation right after an address stays (it ends the sentence, not the URL).
  return text.replace(/\b(?:https?|ftp):\/\/[^\s)\]}>"']*[^\s)\]}>"'.,;:!?]/gi, "…");
}

/**
 * Crawl log lines read `[12/150] https://site/story/chapter-12 — message`. The address
 * becomes the chapter's file name (or nothing, when the chapter is not known here).
 */
export function logText(text: string, fileForUrl: (url: string) => string | null): string {
  const match = /^\[(\d+)\/(\d+)\] (\S+) — ([\s\S]*)$/.exec(text);
  if (!match) return stripUrls(text);
  const [, cursor, total, url, message] = match;
  const file = url === "undefined" ? null : fileForUrl(url);
  return `[${cursor}/${total}] ${file ? `${file} — ` : ""}${stripUrls(message)}`;
}
