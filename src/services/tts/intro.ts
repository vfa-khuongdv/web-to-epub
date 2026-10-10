/**
 * The sentence read before a story's first chapter, introducing the channel. It is part of
 * that chapter's narration (one more part, ahead of the text), and its wording is recorded in
 * the chapter's audio meta so everything that lines the text up with the audio — the reader's
 * highlight, the illustrated captions — can add the same part.
 */
export const DEFAULT_INTRO = "Chào mừng các bạn đến với kênh {channel}. Sau đây, mời các bạn cùng nghe truyện {title}.";
export const MAX_INTRO_CHARS = 400;

// "Hoàng Tử Bé – Antoine De Saint-Exupéry": the part before the author is what is read as the title.
export function spokenTitle(title: string): string {
  return title.split(/\s[–—-]\s/)[0].trim() || title.trim();
}

export function introSentence(template: string, vars: { channel: string; title: string }): string {
  const text = (template.trim() || DEFAULT_INTRO)
    .replaceAll("{channel}", vars.channel.trim())
    .replaceAll("{title}", spokenTitle(vars.title))
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, MAX_INTRO_CHARS);
}
