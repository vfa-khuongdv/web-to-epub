import { CircleX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChapterLines } from "../../hooks/useChapterLines";
import { useStoryList } from "../../hooks/useStoryList";
import { useLang } from "../../i18n";
import { startStoryCrawl, stopStoryCrawl } from "../../lib/api";
import { wordCount } from "../../lib/skins/chapterLines";
import { chapterFileName, storyFolderName } from "../../lib/skins/slug";
import { requestStealthToggle } from "../../lib/ui/stealth";
import { AppMenu, MenuEntry } from "../AppMenu";
import { CommandPalette } from "../CommandPalette";
import { useAppMenuEntries, useLookEntries, useMenuState } from "../useAppMenu";
import { CODE_ICON } from "../registry";
import { SkinAppContext } from "../types";
import { useSkinCommands } from "../useSkinCommands";
import { ActivityBar, SideView } from "./ActivityBar";
import { codeCommands, fileCommands } from "./commands";
import { EditorGroup, EditorText } from "./EditorGroup";
import { TreeHandlers } from "./ExplorerTree";
import { FileNotice } from "./FileNotice";
import { GlobalAction, globalAction } from "./keys";
import { OutputLine, Panel, PanelTab, Problem } from "./Panel";
import { SideBar } from "./SideBar";
import { StatusBar } from "./StatusBar";
import { StoryChaptersSource } from "./StoryChaptersSource";
import { tabKey } from "./tabs";
import { ShellCommand, ShellOutput } from "./TerminalView";
import { stripUrls } from "./terminal";
import { TitleBar, TitleMenu } from "./TitleBar";
import { buildTree, chapterFile, fileKey, fileState, searchTree } from "./tree";
import { useWorkspace } from "./useWorkspace";
import { Welcome } from "./Welcome";

// Rows the PROBLEMS list draws at most (the count in the status bar stays exact).
const PROBLEM_ROWS = 500;

/**
 * The code-editor skin: the library as a workspace of folders (stories) and Markdown
 * files (chapters), read in the editor. Everything the skin does not draw — adding
 * stories, export, settings — is one palette command away.
 */
export default function CodeShell({ app }: { app: SkinAppContext }) {
  const { t } = useLang();
  const { job, live, setHead, openInDefault, openSettings, isPrivate, neutralNames: neutral } = app;
  const library = useStoryList(live);
  const { stories, loading: storiesLoading, error: storiesError, reload: reloadStories } = library;
  const workspace = useWorkspace(app, { stories, loading: storiesLoading, error: storiesError, live });
  const { active, activeStoryId, chapterData, overlay, editors, openFile, openStory, step, closeEditor } = workspace;

  const [view, setView] = useState<SideView>("explorer");
  // A narrow window starts with the editor alone, as the editor itself does.
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 760);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("terminal");
  const [palette, setPalette] = useState<"commands" | "files" | null>(null);
  const [query, setQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState(0);
  const [terminalFocus, setTerminalFocus] = useState(0);
  const [editorFocus, setEditorFocus] = useState(0);
  const [cursor, setCursor] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  const names = useMemo(
    () => new Map(stories.map((story, index) => [story.id, storyFolderName(story.title, index, neutral)])),
    [stories, neutral]
  );
  const liveChapters = overlay?.chapters;
  const activeFolder = activeStoryId ? names.get(activeStoryId) ?? null : null;
  const activeStory = activeStoryId ? chapterData[activeStoryId]?.story ?? null : null;

  const chapterOf = useCallback(
    (storyId: string, order: number) => chapterData[storyId]?.story?.chapters.find((chapter) => chapter.order === order) ?? null,
    [chapterData]
  );
  const fileNameOf = useCallback(
    (storyId: string, order: number) => {
      const chapter = chapterOf(storyId, order);
      return chapter ? chapterFile(chapter, neutral) : chapterFileName(order, "", neutral);
    },
    [chapterOf, neutral]
  );

  // The open file and its text (fetched only once the chapter is downloaded).
  const activeKey = editors.active;
  const activeChapter = active ? chapterOf(active.storyId, active.order) : null;
  const state = activeChapter ? fileState(activeChapter, active?.storyId === overlay?.storyId ? liveChapters : undefined) : null;
  const version = active ? workspace.versions[active.storyId] ?? 0 : 0;
  const readable = !!active && state === "done";
  const chapterText = useChapterLines(readable ? active.storyId : null, readable ? active.order : null, version);
  const activeName = active ? fileNameOf(active.storyId, active.order) : null;
  const activeChapters = active ? chapterData[active.storyId]?.story?.chapters ?? null : null;
  const nextIndex = activeChapters && active ? activeChapters.findIndex((chapter) => chapter.order === active.order) : -1;
  const nextChapter = activeChapters && nextIndex >= 0 ? activeChapters[nextIndex + 1] ?? null : null;
  const previousChapter = activeChapters && nextIndex > 0 ? activeChapters[nextIndex - 1] : null;
  const words = useMemo(() => (chapterText.text ? wordCount(chapterText.text.lines) : 0), [chapterText.text]);

  const { commands, crawlError, clearCrawlError } = useSkinCommands(app, {
    storyId: activeStoryId,
    order: active?.order ?? null,
  });

  // File / View / layout drop-downs: every way out of the skin, without a shortcut.
  const titleMenu = useMenuState<TitleMenu>();
  const looks = useLookEntries();
  const activeOrder = active?.order;
  const openHereInDefault = useCallback(
    () => openInDefault(activeStoryId ? { storyId: activeStoryId, order: activeOrder } : undefined),
    [openInDefault, activeStoryId, activeOrder]
  );
  const fileMenu = useAppMenuEntries({ openInDefault: openHereInDefault, openSettings });

  useEffect(() => {
    setHead({ title: activeName ? `${activeName} — workspace` : "Welcome — workspace", favicon: CODE_ICON });
  }, [activeName, setHead]);
  useEffect(() => () => setHead(null), [setHead]);

  // The other library has other stories.
  const library0 = useRef(isPrivate);
  useEffect(() => {
    if (library0.current === isPrivate) return;
    library0.current = isPrivate;
    void reloadStories();
  }, [isPrivate, reloadStories]);

  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const togglePanel = useCallback(() => {
    if (panelOpenRef.current) {
      setPanelOpen(false);
      setEditorFocus((n) => n + 1);
    } else {
      setPanelOpen(true);
      setTerminalFocus((n) => n + 1);
    }
  }, []);
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  const showView = useCallback((next: SideView) => {
    setView(next);
    setSidebarOpen(true);
    if (next === "search") setSearchFocus((n) => n + 1);
  }, []);
  const openPanelAt = useCallback((tab: PanelTab) => {
    setPanelTab(tab);
    setPanelOpen(true);
    if (tab === "terminal") setTerminalFocus((n) => n + 1);
  }, []);

  // Window-wide shortcuts (F1, Ctrl/Cmd+P, B, J, W, Ctrl+`), through a ref so the
  // listener is added once. Left alone inside another dialog (settings).
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const actions = useRef<Record<GlobalAction, () => void>>({} as Record<GlobalAction, () => void>);
  actions.current = {
    palette: () => setPalette("commands"),
    quickOpen: () => setPalette("files"),
    toggleSidebar,
    togglePanel,
    closeTab: () => closeEditor(),
    showExplorer: () => showView("explorer"),
    showSearch: () => showView("search"),
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = globalAction(event);
      if (!action) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!paletteRef.current && target?.closest('[role="dialog"]')) return;
      event.preventDefault();
      actions.current[action]();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const rows = useMemo(
    () =>
      buildTree({
        stories,
        names,
        expanded: workspace.expanded,
        data: chapterData,
        pages: workspace.pages,
        live,
        overlay,
        neutral,
      }),
    [stories, names, workspace.expanded, chapterData, workspace.pages, live, overlay, neutral]
  );

  const searchResult = useMemo(
    () => searchTree(view === "search" ? query : "", { stories, names, data: chapterData, overlay, neutral }),
    [view, query, stories, names, chapterData, overlay, neutral]
  );

  const treeHandlers: TreeHandlers = {
    onToggleFolder: workspace.toggleFolder,
    onOpenFile: (storyId, order, fromKeyboard) => {
      openFile(storyId, order);
      if (fromKeyboard) setEditorFocus((n) => n + 1);
    },
    onPage: workspace.changePage,
    onRetry: (storyId) => chapterData[storyId]?.reload(),
    onSelect: workspace.setSelected,
  };

  const crawl = (storyId: string) => {
    setNotice(null);
    clearCrawlError();
    startStoryCrawl(storyId).catch((err: Error) => setNotice(err.message));
  };

  const runTerminal = async (command: ShellCommand): Promise<ShellOutput> => {
    if (command === "hide") {
      requestStealthToggle();
      return [];
    }
    if (!activeStoryId) return [{ text: t("No folder is open."), error: true }];
    if (command === "open") {
      openInDefault({ storyId: activeStoryId, order: active?.order });
      return [];
    }
    try {
      if (command === "crawl") {
        const running = live[activeStoryId];
        if (running) return [{ text: t("Downloading {done}/{total}", { done: running.cursor, total: running.total }) }];
        const { total } = await startStoryCrawl(activeStoryId);
        return [{ text: total > 0 ? t("Downloading {count} files…", { count: total }) : t("Nothing to download.") }];
      }
      if (!live[activeStoryId]) return [{ text: t("Nothing is downloading.") }];
      await stopStoryCrawl(activeStoryId);
      return [{ text: t("Stopping after the current file.") }];
    } catch (err) {
      return [{ text: stripUrls((err as Error).message), error: true }];
    }
  };

  const urlFiles = useMemo(() => {
    const map = new Map<string, string>();
    for (const chapter of activeStory?.chapters ?? []) map.set(chapter.url, chapterFile(chapter, neutral));
    return map;
  }, [activeStory, neutral]);
  const fileForUrl = useCallback((url: string) => urlFiles.get(url) ?? null, [urlFiles]);

  // PROBLEMS: what failed in the open folder.
  const { problems, errorCount } = useMemo(() => {
    const list: Problem[] = [];
    let count = 0;
    const folder = activeFolder ?? "workspace";
    const add = (problem: Problem) => {
      count++;
      if (list.length < PROBLEM_ROWS) list.push(problem);
    };
    if (crawlError) add({ key: "crawl", storyId: activeStoryId, order: null, file: folder, folder: "", message: stripUrls(crawlError) });
    if (storiesError) add({ key: "stories", storyId: null, order: null, file: "workspace", folder: "", message: storiesError });
    if (activeStoryId) {
      const data = chapterData[activeStoryId];
      if (data?.error) add({ key: "folder", storyId: activeStoryId, order: null, file: folder, folder: "", message: data.error });
      for (const chapter of data?.story?.chapters ?? []) {
        if (fileState(chapter, liveChapters) !== "error") continue;
        add({
          key: `c:${chapter.order}`,
          storyId: activeStoryId,
          order: chapter.order,
          file: chapterFile(chapter, neutral),
          folder,
          message: stripUrls(chapter.error || t("Download failed")),
        });
      }
    }
    return { problems: list, errorCount: count };
  }, [crawlError, storiesError, activeStoryId, activeFolder, chapterData, liveChapters, neutral, t]);

  // OUTPUT: the open folder's downloads at a glance.
  const output = useMemo<OutputLine[]>(() => {
    const lines: OutputLine[] = [{ tone: "info", text: `workspace: ${stories.length} folders` }];
    if (activeStory && activeFolder) {
      const done = activeStory.chapters.filter((chapter) => fileState(chapter, liveChapters) === "done").length;
      lines.push({
        tone: "info",
        text: `${activeFolder}: ${t("Downloaded {done}/{total}", { done, total: activeStory.chapters.length })}`,
      });
      const failed = activeStory.chapters.filter((chapter) => fileState(chapter, liveChapters) === "error").length;
      if (failed > 0) lines.push({ tone: "warning", text: `${activeFolder}: ${t("Download errors: {count}", { count: failed })}` });
    }
    const running = activeStoryId ? live[activeStoryId] : undefined;
    if (running) lines.push({ tone: "info", text: t("Downloading {done}/{total}", { done: running.cursor, total: running.total }) });
    if (crawlError) lines.push({ tone: "error", text: stripUrls(crawlError) });
    if (storiesError) lines.push({ tone: "error", text: storiesError });
    return lines;
  }, [stories.length, activeStory, activeFolder, activeStoryId, live, liveChapters, crawlError, storiesError, t]);

  const recent = useMemo(
    () =>
      [...stories]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((story) => ({ storyId: story.id, name: names.get(story.id) ?? story.id })),
    [stories, names]
  );

  // The palette: the skin's commands in front of the shared ones, or files (quick open).
  const ownCommands = codeCommands(
    t,
    {
      nextFile: () => step(1),
      previousFile: () => step(-1),
      togglePanel,
      toggleSidebar,
      quickOpen: () => setPalette("files"),
      closeEditor: () => closeEditor(),
    },
    { hasFile: !!active, hasNext: !!nextChapter, hasPrevious: !!previousChapter }
  );
  const fileList = useMemo(() => {
    if (palette !== "files") return [];
    const ordered = [...stories].sort((a, b) => Number(b.id === activeStoryId) - Number(a.id === activeStoryId));
    return fileCommands(
      ordered.map((story) => ({
        storyId: story.id,
        folder: names.get(story.id) ?? story.id,
        files: (chapterData[story.id]?.story?.chapters ?? []).map((chapter) => ({
          order: chapter.order,
          name: chapterFile(chapter, neutral),
        })),
      })),
      {
        folder: (storyId) => openStory(storyId, true),
        file: (storyId, order) => {
          openFile(storyId, order);
          setEditorFocus((n) => n + 1);
        },
      }
    );
  }, [palette, stories, activeStoryId, names, chapterData, neutral, openStory, openFile]);

  // The editor body when there is no text to show.
  const text: EditorText | null =
    chapterText.text && active && activeKey
      ? {
          id: `${activeKey}:${version}`,
          lines: chapterText.text.lines,
          initialLine: workspace.tabLines.current.get(activeKey) ?? 0,
          next: nextChapter ? chapterFile(nextChapter, neutral) : null,
        }
      : null;
  const crawling = !!active && !!live[active.storyId];
  const crawlAction = active && !crawling ? { label: t("Download the rest"), run: () => crawl(active.storyId) } : null;
  let body = null;
  if (!active) {
    body = (
      <Welcome
        recent={recent}
        loading={storiesLoading}
        error={storiesError}
        onOpenFolder={(storyId) => openStory(storyId, true)}
        onMore={() => setPalette("files")}
        onOpenDefault={() => openInDefault()}
        onRetry={() => void reloadStories()}
      />
    );
  } else if (!chapterData[active.storyId]?.story) {
    const data = chapterData[active.storyId];
    body =
      data?.error && !data.loading ? (
        <FileNotice tone="error" message={data.error} action={{ label: t("Retry"), run: data.reload }} />
      ) : (
        <FileNotice tone="dim" message={t("Loading…")} />
      );
  } else if (!activeChapter) {
    body = <FileNotice message={t("This file no longer exists.")} />;
  } else if (state === "pending") {
    const running = live[active.storyId];
    body = (
      <FileNotice
        message={
          running
            ? t("Downloading {done}/{total}", { done: running.cursor, total: running.total })
            : t("Not downloaded yet.")
        }
        action={crawlAction}
      />
    );
  } else if (state === "running") {
    body = <FileNotice tone="dim" message={t("Downloading…")} />;
  } else if (state === "error") {
    body = (
      <FileNotice
        tone="error"
        message={`${t("Download failed")}: ${stripUrls(activeChapter.error || "?")}`}
        action={crawlAction}
      />
    );
  } else if (chapterText.error) {
    body = (
      <FileNotice
        tone="error"
        message={`${t("Could not open this file")}: ${stripUrls(chapterText.error)}`}
        action={{ label: t("Retry"), run: () => workspace.bumpVersion(active.storyId) }}
      />
    );
  } else {
    body = <FileNotice tone="dim" message={t("Loading…")} />;
  }

  const toast = crawlError ?? notice;
  const running = activeStoryId ? live[activeStoryId] : undefined;
  const menuEntries: Record<TitleMenu, MenuEntry[]> = {
    File: fileMenu,
    View: [
      { kind: "item", id: "palette", label: t("Show and run commands"), hint: "F1", run: () => setPalette("commands") },
      { kind: "item", id: "sidebar", label: t("Toggle sidebar"), hint: "Ctrl+B", run: toggleSidebar },
      { kind: "item", id: "panel", label: t("Toggle panel"), hint: "Ctrl+J", run: togglePanel },
      { kind: "separator", id: "view-sep" },
      ...looks,
    ],
    Layout: looks,
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-code-editor font-ui text-code-fg">
      {workspace.sourceIds.map((id) => (
        <StoryChaptersSource key={id} storyId={id} live={live} onChange={workspace.onChapterData} />
      ))}
      <TitleBar
        onPalette={() => setPalette("commands")}
        onMenu={(id, element) => titleMenu.open(id, element)}
        onToggleSidebar={toggleSidebar}
        onTogglePanel={togglePanel}
        sidebarOpen={sidebarOpen}
        panelOpen={panelOpen}
      />
      <div className="flex min-h-0 flex-1">
        <ActivityBar
          view={view}
          sidebarOpen={sidebarOpen}
          onView={(next) => (sidebarOpen && view === next ? setSidebarOpen(false) : showView(next))}
          onSettings={openSettings}
        />
        {sidebarOpen && (
          <SideBar
            view={view}
            explorer={{
              rows,
              activeKey: active ? fileKey(active.storyId, active.order) : null,
              handlers: treeHandlers,
              loading: storiesLoading,
              error: storiesError,
              empty: !storiesLoading && !storiesError && stories.length === 0,
              onRefresh: () => {
                void reloadStories();
                for (const id of workspace.sourceIds) chapterData[id]?.reload();
              },
              onCollapseAll: workspace.collapseAll,
              onOpenDefault: () => openInDefault(),
            }}
            search={{
              query,
              onQuery: setQuery,
              result: searchResult,
              focusToken: searchFocus,
              onOpenFolder: (storyId) => openStory(storyId, true),
              onOpenFile: (storyId, order) => openFile(storyId, order),
            }}
          />
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <EditorGroup
            tabs={editors.tabs.map((tab) => ({ key: tabKey(tab), name: fileNameOf(tab.storyId, tab.order) }))}
            activeKey={activeKey}
            onActivate={workspace.activate}
            onClose={closeEditor}
            breadcrumb={active && activeName ? { folder: names.get(active.storyId) ?? "", file: activeName } : null}
            text={text}
            body={body}
            cursor={cursor}
            onCursor={setCursor}
            onTopLine={workspace.onTopLine}
            onNext={() => step(1)}
            onPrevious={() => step(-1)}
            focusToken={editorFocus}
          />
          <Panel
            open={panelOpen}
            tab={panelTab}
            onTab={openPanelAt}
            onClose={togglePanel}
            problems={problems}
            onOpenProblem={(problem) => {
              if (problem.storyId && problem.order !== null) openFile(problem.storyId, problem.order);
            }}
            output={output}
            terminal={{
              log: job.log,
              fileForUrl,
              folder: activeFolder,
              run: runTerminal,
              focusToken: terminalFocus,
            }}
          />
        </main>
      </div>
      <StatusBar
        errors={errorCount}
        crawl={running ? { cursor: running.cursor, total: running.total } : null}
        file={text ? { line: cursor, words } : null}
        onProblems={() => openPanelAt("problems")}
        onTerminal={() => openPanelAt("terminal")}
      />
      <AppMenu
        anchor={titleMenu.menu?.anchor ?? null}
        entries={titleMenu.menu ? menuEntries[titleMenu.menu.id] : []}
        onClose={titleMenu.close}
        tone="code"
        label={titleMenu.menu?.id ?? ""}
      />
      <CommandPalette
        open={palette !== null}
        onClose={() => setPalette(null)}
        commands={palette === "files" ? fileList : [...ownCommands, ...commands]}
        placeholder={palette === "files" ? t("Search files by name") : t("Type a command")}
        tone="code"
      />
      {toast && (
        <div
          role="alert"
          className="fixed bottom-[30px] right-3 z-30 flex w-[min(440px,calc(100vw-24px))] items-start gap-2.5 border border-code-border bg-code-side px-3 py-2.5 text-[13px] text-code-fg shadow-[0_0_8px_2px_rgba(0,0,0,0.25)]"
        >
          <CircleX size={16} className="mt-px flex-none text-code-error" aria-hidden="true" />
          <p className="min-w-0 flex-1 break-words">{stripUrls(toast)}</p>
          <button
            type="button"
            className="grid size-5 flex-none place-items-center rounded-[4px] hover:bg-code-hover outline-none focus-visible:outline-1 focus-visible:outline-code-focus"
            aria-label={t("Close")}
            onClick={() => {
              clearCrawlError();
              setNotice(null);
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
