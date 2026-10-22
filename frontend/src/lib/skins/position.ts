// Where the reader was in a story, per skin view: the chapter and the line (paragraph)
// at the top of the screen. One entry per story and library, like the reader's and the
// player's positions (a story id is a hash of its URL, so it can sit in both libraries).
export interface SkinPosition {
  order: number;
  line: number;
}

function key(storyId: string, isPrivate: boolean): string {
  return `skin-position:${isPrivate ? "private" : "public"}:${storyId}`;
}

export function readSkinPosition(storyId: string, isPrivate: boolean): SkinPosition | null {
  try {
    const raw = localStorage.getItem(key(storyId, isPrivate));
    const saved = raw ? (JSON.parse(raw) as Partial<SkinPosition>) : null;
    return saved && Number.isInteger(saved.order) && Number.isInteger(saved.line)
      ? { order: saved.order!, line: Math.max(0, saved.line!) }
      : null;
  } catch {
    return null;
  }
}

export function writeSkinPosition(storyId: string, isPrivate: boolean, position: SkinPosition): void {
  try {
    localStorage.setItem(key(storyId, isPrivate), JSON.stringify(position));
  } catch {
    /* not remembered */
  }
}
