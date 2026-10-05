import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveCrawl } from "../../hooks/useCrawlJob";
import { readSkinPosition, writeSkinPosition } from "../../lib/skins/position";
import { StorySummary } from "../../types";
import { SkinAppContext } from "../types";
import { readLastFolder, writeLastFolder } from "./session";
import {
  Editors,
  NO_EDITORS,
  activeTab,
  adjacentOrder,
  closeTab,
  keepStories,
  openTab,
  replaceActive,
  tabKey,
} from "./tabs";
import { ChapterData, LiveOverlay, pageOf, pageRange } from "./tree";

function withId(set: Set<string>, id: string): Set<string> {
  return set.has(id) ? set : new Set(set).add(id);
}

/**
 * The code skin's workspace state: open folders and their pages, the chapter lists
 * loaded for them, the open editors with the line each one shows, and the reading
 * position saved as the reader scrolls. The shell draws it; this decides it.
 */
export function useWorkspace(
  app: Pick<SkinAppContext, "attach" | "isPrivate" | "job">,
  library: { stories: StorySummary[]; loading: boolean; error: string | null; live: Record<string, LiveCrawl | undefined> }
) {
  const { attach, isPrivate, job } = app;
  const { stories, loading, error, live } = library;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pages, setPages] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [chapterData, setChapterData] = useState<Record<string, ChapterData>>({});
  const [editors, setEditors] = useState<Editors>(NO_EDITORS);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [wantFirst, setWantFirst] = useState<string | null>(null);
  // The paragraph each open tab shows at its top, so switching tabs comes back to it.
  const tabLines = useRef(new Map<string, number>());

  const active = activeTab(editors);
  const activeStoryId = active?.storyId ?? selected;
  const editorsRef = useRef(editors);
  editorsRef.current = editors;
  const activeRef = useRef(active);
  activeRef.current = active;
  const dataRef = useRef(chapterData);
  dataRef.current = chapterData;

  const onChapterData = useCallback((id: string, data: ChapterData | null) => {
    setChapterData((previous) => {
      if (data) return { ...previous, [id]: data };
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }, []);

  // Chapter lists to keep loaded: open folders, stories with open tabs, the active one.
  const sourceIds = useMemo(() => {
    const ids = new Set(expanded);
    for (const tab of editors.tabs) ids.add(tab.storyId);
    if (activeStoryId) ids.add(activeStoryId);
    if (wantFirst) ids.add(wantFirst);
    return [...ids];
  }, [expanded, editors.tabs, activeStoryId, wantFirst]);

  // The live per-chapter overlay belongs to the story the crawl channel follows.
  const overlay = useMemo<LiveOverlay | null>(
    () => (activeStoryId ? { storyId: activeStoryId, chapters: job.chapters } : null),
    [activeStoryId, job.chapters]
  );

  useEffect(() => {
    if (!activeStoryId) return;
    return attach("workspace", activeStoryId);
  }, [attach, activeStoryId]);

  useEffect(() => {
    if (activeStoryId) writeLastFolder(isPrivate, activeStoryId);
  }, [activeStoryId, isPrivate]);

  const openFile = useCallback(
    (storyId: string, order: number, options: { line?: number; replace?: boolean } = {}) => {
      const tab = { storyId, order };
      const key = tabKey(tab);
      if (options.line !== undefined) {
        tabLines.current.set(key, options.line);
      } else if (!tabLines.current.has(key)) {
        const saved = readSkinPosition(storyId, isPrivate);
        tabLines.current.set(key, saved && saved.order === order ? saved.line : 0);
      }
      setEditors((previous) => (options.replace ? replaceActive(previous, tab) : openTab(previous, tab)));
      setSelected(storyId);
      setExpanded((previous) => withId(previous, storyId));
    },
    [isPrivate]
  );

  /**
   * Opens a folder. With `reveal` (the welcome page, quick open) its open tab is shown,
   * or it opens where the reader left off, or at its first chapter. Without (expanding it
   * in the tree) it only opens the remembered chapter, and only when none of its files
   * is open already.
   */
  const openStory = useCallback(
    (storyId: string, reveal: boolean) => {
      setSelected(storyId);
      setExpanded((previous) => withId(previous, storyId));
      const open = editorsRef.current.tabs.filter((tab) => tab.storyId === storyId);
      if (open.length > 0) {
        if (reveal && !open.some((tab) => tabKey(tab) === editorsRef.current.active)) {
          setEditors((previous) => ({ ...previous, active: tabKey(open[open.length - 1]) }));
        }
        return;
      }
      const saved = readSkinPosition(storyId, isPrivate);
      if (saved) openFile(storyId, saved.order, { line: saved.line });
      else if (reveal) setWantFirst(storyId);
    },
    [isPrivate, openFile]
  );

  const toggleFolder = useCallback(
    (storyId: string) => {
      if (expanded.has(storyId)) {
        setExpanded((previous) => {
          const next = new Set(previous);
          next.delete(storyId);
          return next;
        });
      } else {
        openStory(storyId, false);
      }
    },
    [expanded, openStory]
  );

  const changePage = useCallback((storyId: string, direction: 1 | -1) => {
    const total = dataRef.current[storyId]?.story?.chapters.length ?? 0;
    setPages((previous) => ({ ...previous, [storyId]: pageRange(total, (previous[storyId] ?? 0) + direction).page }));
  }, []);

  const activate = useCallback((key: string) => setEditors((previous) => ({ ...previous, active: key })), []);

  const closeEditor = useCallback((key?: string) => {
    setEditors((previous) => {
      const target = key ?? previous.active;
      return target ? closeTab(previous, target) : previous;
    });
  }, []);

  // Next/previous file turns the active tab into that chapter, from its top.
  const step = useCallback(
    (direction: 1 | -1) => {
      const tab = activeRef.current;
      if (!tab) return;
      const chapters = dataRef.current[tab.storyId]?.story?.chapters;
      if (!chapters) return;
      const order = adjacentOrder(chapters, tab.order, direction);
      if (order !== null) openFile(tab.storyId, order, { line: 0, replace: true });
    },
    [openFile]
  );

  // The reading position: the paragraph at the top of the active file, as it scrolls.
  const onTopLine = useCallback(
    (textId: string, paragraph: number) => {
      const tab = activeRef.current;
      if (!tab) return;
      const key = tabKey(tab);
      if (!textId.startsWith(`${key}:`)) return;
      tabLines.current.set(key, paragraph);
      writeSkinPosition(tab.storyId, isPrivate, { order: tab.order, line: paragraph });
    },
    [isPrivate]
  );

  // A welcome-page folder with nothing remembered opens at its first downloaded chapter.
  useEffect(() => {
    if (!wantFirst) return;
    const data = chapterData[wantFirst];
    if (!data || (!data.story && !data.error)) return;
    setWantFirst(null);
    const chapters = data.story?.chapters ?? [];
    const first = chapters.find((chapter) => chapter.status === "done") ?? chapters[0];
    if (first) openFile(wantFirst, first.order, { line: 0 });
  }, [wantFirst, chapterData, openFile]);

  // The tree shows the page holding the active file whenever another file opens.
  const activeStory = active ? chapterData[active.storyId]?.story ?? null : null;
  useEffect(() => {
    if (!active || !activeStory) return;
    const index = activeStory.chapters.findIndex((chapter) => chapter.order === active.order);
    if (index < 0) return;
    const page = pageOf(index);
    setPages((previous) => ((previous[active.storyId] ?? 0) === page ? previous : { ...previous, [active.storyId]: page }));
    // Only on a newly opened file (or its list arriving), so paging away stays put.
  }, [editors.active, activeStory]);

  // A finished crawl rewrote chapters: drop the cached text of that story.
  const liveKey = Object.keys(live)
    .filter((id) => live[id])
    .sort()
    .join(",");
  const previousLive = useRef<string[]>([]);
  useEffect(() => {
    const now = liveKey ? liveKey.split(",") : [];
    const ended = previousLive.current.filter((id) => !now.includes(id));
    previousLive.current = now;
    if (ended.length === 0) return;
    setVersions((previous) => {
      const next = { ...previous };
      for (const id of ended) next[id] = (next[id] ?? 0) + 1;
      return next;
    });
  }, [liveKey]);

  const bumpVersion = useCallback((storyId: string) => {
    setVersions((previous) => ({ ...previous, [storyId]: (previous[storyId] ?? 0) + 1 }));
  }, []);

  // Stories that left the library (deleted elsewhere) close their tabs and folders.
  useEffect(() => {
    if (loading || error) return;
    const ids = new Set(stories.map((story) => story.id));
    setEditors((previous) => keepStories(previous, ids));
    setExpanded((previous) => ([...previous].every((id) => ids.has(id)) ? previous : new Set([...previous].filter((id) => ids.has(id)))));
    setSelected((previous) => (previous && ids.has(previous) ? previous : null));
  }, [stories, loading, error]);

  // Forget the line of tabs that closed.
  useEffect(() => {
    const open = new Set(editors.tabs.map(tabKey));
    for (const key of [...tabLines.current.keys()]) if (!open.has(key)) tabLines.current.delete(key);
  }, [editors.tabs]);

  // Back to the folder that was open last time, where the reader left off.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || loading) return;
    restored.current = true;
    const last = readLastFolder(isPrivate);
    if (last && stories.some((story) => story.id === last)) openStory(last, false);
  }, [loading, stories, isPrivate, openStory]);

  // The other library (private mode switched): nothing open carries over.
  const library0 = useRef(isPrivate);
  useEffect(() => {
    if (library0.current === isPrivate) return;
    library0.current = isPrivate;
    setEditors(NO_EDITORS);
    setExpanded(new Set());
    setSelected(null);
    setPages({});
    tabLines.current.clear();
    restored.current = false;
  }, [isPrivate]);

  return {
    expanded,
    collapseAll: () => setExpanded(new Set()),
    pages,
    setSelected,
    chapterData,
    onChapterData,
    sourceIds,
    overlay,
    editors,
    active,
    activeStoryId,
    tabLines,
    versions,
    bumpVersion,
    openFile,
    openStory,
    toggleFolder,
    changePage,
    activate,
    closeEditor,
    step,
    onTopLine,
  };
}
