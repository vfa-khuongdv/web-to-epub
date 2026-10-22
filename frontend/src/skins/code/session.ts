// The folder the code skin had open last, per library, so the next visit reopens it where
// the reader left off (the chapter and line come from lib/skins/position). A convenience:
// when storage is blocked the skin simply starts on its welcome page.

function key(isPrivate: boolean): string {
  return `skin-code-folder:${isPrivate ? "private" : "public"}`;
}

export function readLastFolder(isPrivate: boolean): string | null {
  try {
    return localStorage.getItem(key(isPrivate));
  } catch {
    return null;
  }
}

export function writeLastFolder(isPrivate: boolean, storyId: string): void {
  try {
    localStorage.setItem(key(isPrivate), storyId);
  } catch {
    /* not remembered */
  }
}
