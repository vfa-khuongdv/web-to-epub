/**
 * Words in a chapter's HTML, as the reader shows them. Vietnamese is written with a
 * space between syllables, so counting whitespace-separated runs gives the number a
 * reader expects. The HTML is parsed, never injected, so nothing in it runs.
 */
export function countWords(html: string): number {
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  return text.match(/\S+/g)?.length ?? 0;
}
