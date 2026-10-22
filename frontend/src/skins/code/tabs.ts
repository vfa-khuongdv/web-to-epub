// Open editors (tabs): which chapter files are open and which one shows. Pure state
// transitions, so the shell only wires them to clicks and keys.

export interface EditorTab {
  storyId: string;
  order: number;
}

export interface Editors {
  tabs: EditorTab[];
  active: string | null;
}

// More would not fit the strip at a normal width, and a reader rarely needs them.
export const MAX_TABS = 8;

export const NO_EDITORS: Editors = { tabs: [], active: null };

export function tabKey(tab: EditorTab): string {
  return `${tab.storyId}:${tab.order}`;
}

export function activeTab(editors: Editors): EditorTab | null {
  return editors.tabs.find((tab) => tabKey(tab) === editors.active) ?? null;
}

/**
 * Opens a file: shows its tab when it is open already, otherwise adds one right of the
 * active tab (where the editor puts it). Past MAX_TABS the leftmost tab that is neither
 * the new one nor the one being left goes.
 */
export function openTab(editors: Editors, tab: EditorTab, max = MAX_TABS): Editors {
  const key = tabKey(tab);
  if (editors.tabs.some((open) => tabKey(open) === key)) return { ...editors, active: key };
  const at = editors.tabs.findIndex((open) => tabKey(open) === editors.active);
  const tabs = [...editors.tabs];
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
  while (tabs.length > max) {
    const drop = tabs.findIndex((open) => {
      const openKey = tabKey(open);
      return openKey !== key && openKey !== editors.active;
    });
    tabs.splice(drop < 0 ? 0 : drop, 1);
  }
  return { tabs, active: key };
}

/**
 * Next/previous file: the active tab turns into the other chapter (reading on does not
 * pile up tabs). When that chapter has a tab of its own already, it is shown instead.
 */
export function replaceActive(editors: Editors, tab: EditorTab): Editors {
  const key = tabKey(tab);
  if (editors.tabs.some((open) => tabKey(open) === key)) return { ...editors, active: key };
  const at = editors.tabs.findIndex((open) => tabKey(open) === editors.active);
  if (at < 0) return openTab(editors, tab);
  const tabs = [...editors.tabs];
  tabs[at] = tab;
  return { tabs, active: key };
}

// Closing the active tab shows its right neighbour, or the left one at the end.
export function closeTab(editors: Editors, key: string): Editors {
  const at = editors.tabs.findIndex((tab) => tabKey(tab) === key);
  if (at < 0) return editors;
  const tabs = editors.tabs.filter((_, index) => index !== at);
  if (editors.active !== key) return { tabs, active: editors.active };
  const next = tabs[at] ?? tabs[at - 1] ?? null;
  return { tabs, active: next ? tabKey(next) : null };
}

// Drops the tabs of stories that are gone (deleted, or the other library).
export function keepStories(editors: Editors, storyIds: Set<string>): Editors {
  if (editors.tabs.every((tab) => storyIds.has(tab.storyId))) return editors;
  let next = editors;
  for (const tab of editors.tabs) if (!storyIds.has(tab.storyId)) next = closeTab(next, tabKey(tab));
  return next;
}

// The chapter before or after `order` in the story's list, or null at either end.
export function adjacentOrder(chapters: { order: number }[], order: number, step: 1 | -1): number | null {
  const at = chapters.findIndex((chapter) => chapter.order === order);
  if (at < 0) return null;
  return chapters[at + step]?.order ?? null;
}
