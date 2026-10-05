import { KeyboardEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChapterText, useChapterLines } from "../../hooks/useChapterLines";
import { LiveCrawl } from "../../hooks/useCrawlJob";
import { useStoryChapters } from "../../hooks/useStoryChapters";
import { useStoryList } from "../../hooks/useStoryList";
import { useLang } from "../../i18n";
import { wordCount } from "../../lib/skins/chapterLines";
import { readSkinPosition, writeSkinPosition } from "../../lib/skins/position";
import { sheetName } from "../../lib/skins/slug";
import { SKIN_IDS } from "../../lib/ui/skin";
import { AppMenu, MenuEntry } from "../AppMenu";
import { CommandPalette } from "../CommandPalette";
import { SHEET_ICON, SKINS } from "../registry";
import { useSkin } from "../SkinProvider";
import { useAppMenuEntries, useLookEntries, useMenuState } from "../useAppMenu";
import { SkinAppContext } from "../types";
import { useSkinCommands } from "../useSkinCommands";
import { FormulaBar, RibbonMenu, RibbonTabs, TitleBar } from "./SheetChrome";
import { GridRestore, SheetGrid, SheetGridHandle } from "./SheetGrid";
import { HomeRibbon } from "./SheetRibbon";
import { SheetStatusBar, StatusPaging } from "./SheetStatusBar";
import { SheetTabs } from "./SheetTabs";
import { StatusMessage } from "./StatusMessage";
import {
  HEADER_ROWS,
  LIBRARY_SHEET,
  PAGE_SIZE,
  WORKBOOK,
  cellAddress,
  chapterSheetName,
  clampPos,
  formatNumber,
  lineToRow,
  pageBounds,
  pageCount,
  pageOfIndex,
  pagedMove,
  rowToLine,
  selectionSummary,
} from "./sheetModel";
import { sheetCommands } from "./sheetCommands";
import { adjacentChapter, sortChapters } from "./sheetRows";
import { buildSheet } from "./sheetView";
import { useCrawlVersions } from "./useCrawlVersions";
import { useProgramKeys } from "./useProgramKeys";
import {
  INITIAL_WORKBOOK,
  LIBRARY_KEY,
  SheetRef,
  activeRef,
  selectionOf,
  sheetKey,
  uniqueNames,
  viewKey,
  workbookReducer,
} from "./workbook";

const ZOOM_KEY = "sheet-zoom";
const NOTICE_MS = 4000;
const NO_LIVE = {};

// The row of a story (library) or chapter (story sheet) on its paged sheet.
function placeOf(index: number) {
  const page = pageOfIndex(index);
  return { page, selection: { row: index - page * PAGE_SIZE + HEADER_ROWS, col: 0 } };
}

function readZoom(): number {
  try {
    const saved = Number(localStorage.getItem(ZOOM_KEY));
    return saved >= 50 && saved <= 200 ? saved : 100;
  } catch {
    return 100;
  }
}

// Where a view was left this session, so flipping between sheets comes back to it.
interface ViewMemo {
  top: number;
  left: number;
}

/**
 * The spreadsheet skin: the library as the "Danh_muc" sheet, a story as a sheet of its
 * chapters, and a chapter as a sheet with one paragraph per row in a wide, wrapped
 * column B. Everything the skin does not draw (adding stories, export, settings, crawl,
 * narration) is in the command palette (F1, Alt+Q, the search box, Find & Select).
 */
export default function SheetShell({ app }: { app: SkinAppContext }) {
  const { t } = useLang();
  const { attach, setHead, isPrivate, neutralNames: neutral, live } = app;
  const [book, dispatch] = useReducer(workbookReducer, INITIAL_WORKBOOK);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [zoom, setZoom] = useState(readZoom);
  const [notice, setNotice] = useState<string | null>(null);
  // Word counts of the chapters read this session, per story then chapter order.
  const [words, setWords] = useState<Record<string, Record<number, number>>>({});
  const versions = useCrawlVersions(live);
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<SheetGridHandle>(null);
  const memos = useRef(new Map<string, ViewMemo>());
  // The line at the top of each chapter view seen this session.
  const topLines = useRef(new Map<string, number>());
  // A chapter opened at a remembered line, and a story opened at its last-read chapter.
  const pendingLine = useRef<{ view: string; line: number } | null>(null);
  const pendingFocus = useRef<{ storyId: string; order: number } | null>(null);
  const keepTabFocus = useRef(false);

  const ref = activeRef(book);
  const storyId = ref.kind === "library" ? null : ref.storyId;
  const order = ref.kind === "chapter" ? ref.order : null;
  const key = sheetKey(ref);
  const page = book.pages[key] ?? 0;
  const gridKey = `${viewKey(ref)}#${page}`;

  const storyList = useStoryList(live);
  const storyData = useStoryChapters(storyId, live);
  const chapterText = useChapterLines(order !== null ? storyId : null, order, storyId ? (versions[storyId] ?? 0) : 0);
  const chapters = useMemo(() => (storyData.story ? sortChapters(storyData.story.chapters) : null), [storyData.story]);
  const liveStates = storyId && live[storyId] ? app.job.chapters : undefined;
  const storyWords = useMemo(() => (storyId ? (words[storyId] ?? {}) : {}), [words, storyId]);

  // Each sheet sees only the live data it draws, so a crawl ticking in the background does
  // not redraw a chapter being read.
  const sheetLive = ref.kind === "library" ? live : NO_LIVE;
  const sheetLiveStates = ref.kind === "story" ? liveStates : undefined;
  const { stories, loading: listLoading, error: listError } = storyList;
  const { loading: textLoading, error: textError } = chapterText;
  // A chapter re-read after its crawl ended keeps its old text on screen until the new
  // one is in, so the reader is not thrown back to the top.
  const lastText = useRef<{ key: string; text: ChapterText } | null>(null);
  const textKey = storyId && order !== null ? `${storyId}:${order}` : null;
  if (chapterText.text && textKey) lastText.current = { key: textKey, text: chapterText.text };
  const textValue =
    chapterText.text ?? (!textError && textKey && lastText.current?.key === textKey ? lastText.current.text : null);
  const sheet = useMemo(
    () =>
      buildSheet(
        ref,
        {
          stories: { list: stories, loading: listLoading, error: listError },
          chapters: { list: chapters, loading: storyData.loading, error: storyData.error },
          text: { value: textValue, loading: textLoading, error: textError },
          live: sheetLive,
          liveStates: sheetLiveStates,
          words: storyWords,
          neutral,
          page,
        },
        t
      ),
    [
      ref,
      stories,
      listLoading,
      listError,
      chapters,
      storyData.loading,
      storyData.error,
      textValue,
      textLoading,
      textError,
      sheetLive,
      sheetLiveStates,
      storyWords,
      neutral,
      page,
      t,
    ]
  );
  const { rows, columns } = sheet;
  const selection = clampPos(selectionOf(book, ref), rows.length, columns.length);
  const pages = pageCount(sheet.total);

  // Sheet names: neutral ones hide every title; even without, a slug, never the title.
  const storySheetName = useCallback(
    (id: string) => {
      const index = stories.findIndex((story) => story.id === id);
      const title = index >= 0 ? stories[index].title : "";
      return sheetName(title, index >= 0 ? index : stories.length, neutral);
    },
    [stories, neutral]
  );
  const tabs = useMemo(() => {
    const names = uniqueNames(
      book.tabs.map((tab) =>
        tab.kind === "library"
          ? LIBRARY_SHEET
          : tab.kind === "story"
            ? storySheetName(tab.storyId)
            : chapterSheetName(tab.order, neutral)
      )
    );
    return book.tabs.map((tab, index) => ({ key: sheetKey(tab), name: names[index], closable: tab.kind !== "library" }));
  }, [book.tabs, storySheetName, neutral]);
  const activeName = tabs.find((tab) => tab.key === book.active)?.name ?? LIBRARY_SHEET;

  // ---- Opening sheets -------------------------------------------------------------

  const openStory = useCallback(
    (id: string) => {
      const saved = readSkinPosition(id, isPrivate);
      pendingFocus.current = saved ? { storyId: id, order: saved.order } : null;
      dispatch({ type: "open", ref: { kind: "story", storyId: id } });
    },
    [isPrivate]
  );

  const openChapter = useCallback(
    (id: string, chapterOrder: number, line?: number) => {
      const target: SheetRef = { kind: "chapter", storyId: id, order: chapterOrder };
      const view = `${viewKey(target)}#0`;
      const saved = readSkinPosition(id, isPrivate);
      const startLine = line ?? (saved && saved.order === chapterOrder ? saved.line : 0);
      // A chapter already open this session comes back as it was left.
      const seen = memos.current.has(view);
      pendingLine.current = seen ? null : { view, line: startLine };
      dispatch({ type: "open", ref: target, selection: seen ? undefined : { row: lineToRow(startLine), col: 1 } });
      const lineNow = seen ? (topLines.current.get(view) ?? startLine) : startLine;
      writeSkinPosition(id, isPrivate, { order: chapterOrder, line: lineNow });
    },
    [isPrivate]
  );

  const stepChapter = useCallback(
    (direction: 1 | -1) => {
      if (ref.kind !== "chapter" || !chapters) return;
      const to = adjacentChapter(chapters, ref.order, direction, liveStates);
      if (to === null) {
        setNotice(direction === 1 ? t("Nothing later.") : t("Nothing earlier."));
        return;
      }
      openChapter(ref.storyId, to, 0);
    },
    [ref, chapters, liveStates, openChapter, t]
  );

  const backToList = useCallback(() => {
    if (ref.kind === "chapter") {
      const index = chapters ? chapters.findIndex((chapter) => chapter.order === ref.order) : -1;
      dispatch({ type: "open", ref: { kind: "story", storyId: ref.storyId }, ...(index >= 0 ? placeOf(index) : {}) });
    } else if (ref.kind === "story") {
      const index = stories.findIndex((story) => story.id === ref.storyId);
      dispatch({ type: "open", ref: { kind: "library" }, ...(index >= 0 ? placeOf(index) : {}) });
    }
  }, [ref, chapters, stories]);

  const turnPage = useCallback(
    (to: number) => dispatch({ type: "page", key, page: to, selection: { row: HEADER_ROWS, col: selection.col } }),
    [key, selection.col]
  );

  const openRow = (rowIndex: number) => {
    const row = rows[rowIndex];
    if (!row || row.header) return;
    if (ref.kind === "library" && typeof row.target === "string") openStory(row.target);
    else if (ref.kind === "story") {
      if (typeof row.target === "number") openChapter(ref.storyId, row.target);
      else if (row.blocked === "error") setNotice(t("Download failed"));
      else if (row.blocked === "pending") setNotice(t("Not downloaded yet."));
    }
  };

  // A story opened again lands on the chapter read last.
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want || ref.kind !== "story" || ref.storyId !== want.storyId || !chapters) return;
    pendingFocus.current = null;
    const index = chapters.findIndex((chapter) => chapter.order === want.order);
    if (index >= 0) dispatch({ type: "page", key, ...placeOf(index) });
  }, [ref, key, chapters]);

  // ---- Live crawl, tab head, word counts, notices -----------------------------------

  useEffect(() => (storyId ? attach("workspace", storyId) : undefined), [attach, storyId]);

  useEffect(() => {
    setHead({ title: book.active === LIBRARY_KEY ? WORKBOOK : `${WORKBOOK} - ${activeName}`, favicon: SHEET_ICON });
  }, [setHead, book.active, activeName]);
  useEffect(() => () => setHead(null), [setHead]);

  useEffect(() => {
    const text = chapterText.text;
    if (!text || !storyId || order === null) return;
    const count = wordCount(text.lines);
    setWords((current) =>
      current[storyId]?.[order] === count ? current : { ...current, [storyId]: { ...current[storyId], [order]: count } }
    );
  }, [chapterText.text, storyId, order]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      /* Not remembered */
    }
  }, [zoom]);

  // ---- Reading position -----------------------------------------------------------

  // Computed once per view: a remembered scroll, else the saved line of a chapter.
  const restore = useMemo<GridRestore | null>(() => {
    const memo = memos.current.get(gridKey);
    if (memo) return memo;
    const pending = pendingLine.current;
    if (pending && pending.view === gridKey && pending.line > 0) return { row: lineToRow(pending.line) };
    return null;
  }, [gridKey]);

  const onScrollPos = useCallback((top: number, left: number) => memos.current.set(gridKey, { top, left }), [gridKey]);

  const chapterReady = ref.kind === "chapter" && sheet.ready && !!textValue;
  const onTopRow = useCallback(
    (row: number) => {
      if (ref.kind !== "chapter" || !chapterReady) return;
      const line = rowToLine(row);
      topLines.current.set(gridKey, line);
      writeSkinPosition(ref.storyId, isPrivate, { order: ref.order, line });
    },
    [ref, chapterReady, isPrivate, gridKey]
  );

  // ---- Keys and focus -------------------------------------------------------------

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  useProgramKeys(root, { openPalette, stepSheet: (delta) => dispatch({ type: "step", delta }) });

  const onGridKey = (event: KeyboardEvent<HTMLTableElement>) => {
    if (event.altKey) return;
    const jump = event.ctrlKey || event.metaKey;
    const { key: name } = event;
    if (name === "PageDown" || name === "PageUp") {
      if (jump) return;
      event.preventDefault();
      const top = grid.current?.pageScroll(name === "PageDown" ? 1 : -1);
      if (top !== undefined) dispatch({ type: "select", pos: { row: top, col: selection.col } });
      return;
    }
    if (name === "Enter") {
      event.preventDefault();
      if (ref.kind === "chapter") {
        const row = Math.min(rows.length - 1, Math.max(0, selection.row + (event.shiftKey ? -1 : 1)));
        dispatch({ type: "select", pos: { row, col: selection.col }, reveal: true });
      } else openRow(selection.row);
      return;
    }
    if (!jump && (name === "]" || name === "[")) {
      if (ref.kind !== "chapter") return;
      event.preventDefault();
      stepChapter(name === "]" ? 1 : -1);
      return;
    }
    const moved = pagedMove(selection, { key: name, jump }, { rows: rows.length, cols: columns.length, page, pages });
    if (!moved) return;
    event.preventDefault();
    if (moved.page !== page) dispatch({ type: "page", key, page: moved.page, selection: moved.pos });
    else dispatch({ type: "select", pos: moved.pos, reveal: true });
  };

  // The grid takes the keys whenever a sheet opens or the palette closes — unless the tabs
  // were being walked with the arrow keys, or something outside the skin (the settings)
  // has taken focus meanwhile.
  useEffect(() => {
    if (paletteOpen) return;
    if (keepTabFocus.current) {
      keepTabFocus.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && !root.current?.contains(active)) return;
      grid.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [gridKey, paletteOpen]);

  // ---- Commands -------------------------------------------------------------------

  const { commands, crawlError, clearCrawlError } = useSkinCommands(app, { storyId, order });
  const backTo = ref.kind === "chapter" ? storySheetName(ref.storyId) : LIBRARY_SHEET;
  const closeSheet = useCallback(() => dispatch({ type: "close", key }), [key]);
  const allCommands = useMemo(
    () => [
      ...sheetCommands(
        { kind: ref.kind, page, pages, backTo, activeName, stepChapter, backToList, turnPage, close: closeSheet },
        t
      ),
      ...commands,
    ],
    [ref.kind, page, pages, backTo, activeName, stepChapter, backToList, turnPage, closeSheet, commands, t]
  );

  // ---- Menus: every way out of the skin, without a shortcut ------------------------

  const { skin, setSkin } = useSkin();
  const ribbonMenu = useMenuState<RibbonMenu>();
  const looks = useLookEntries();
  const openHereInDefault = useCallback(
    () => app.openInDefault(storyId ? { storyId, order: order ?? undefined } : undefined),
    [app, storyId, order]
  );
  const fileMenu = useAppMenuEntries({ openInDefault: openHereInDefault, openSettings: app.openSettings });
  const viewMenu = useMemo<MenuEntry[]>(
    () => [
      ...(ref.kind === "library"
        ? []
        : [
            { kind: "item", id: "back-list", label: t("Back to the list"), run: backToList } as MenuEntry,
            { kind: "separator", id: "view-sep" } as MenuEntry,
          ]),
      ...looks,
    ],
    [ref.kind, backToList, looks, t]
  );
  // The status bar's view buttons, this look first (pressed), then the others.
  const views = [skin, ...SKIN_IDS.filter((id) => id !== skin)].map((id) => ({
    label: t("Switch look: {skin}", { skin: t(SKINS[id].label) }),
    active: id === skin,
    onClick: () => setSkin(id),
  }));

  // ---- Status bar -----------------------------------------------------------------

  const selected = rows[selection.row]?.cells[selection.col]?.text ?? "";
  const crawl = storyId ? live[storyId] : undefined;
  const crawls = crawl
    ? [crawl]
    : ref.kind === "library"
      ? Object.values(live).filter((entry): entry is LiveCrawl => !!entry)
      : [];

  const bounds = pageBounds(page, sheet.total);
  const paging: StatusPaging | null =
    pages > 1
      ? {
          text: t("Rows {from}–{to} of {total}", {
            from: formatNumber(bounds.start + 1),
            to: formatNumber(bounds.end),
            total: formatNumber(sheet.total),
          }),
          previousLabel: t("Previous page"),
          nextLabel: t("Next page"),
          onPrevious: page > 0 ? () => turnPage(page - 1) : undefined,
          onNext: page < pages - 1 ? () => turnPage(page + 1) : undefined,
        }
      : null;

  return (
    <div ref={root} className="flex h-full flex-col overflow-hidden bg-sheet-cell font-sheet text-sheet-fg">
      <TitleBar fileName={WORKBOOK} onSearch={openPalette} searchLabel={t("Show and run commands")} />
      <RibbonTabs onMenu={(id, element) => ribbonMenu.open(id, element)} />
      <HomeRibbon onFind={openPalette} findLabel={t("Show and run commands")} />
      <FormulaBar address={cellAddress(selection.col, rows[selection.row]?.label ?? 1)} formula={selected} />
      <SheetGrid
        key={gridKey}
        ref={grid}
        label="Sheet"
        columns={columns}
        rows={rows}
        selection={selection}
        revealToken={book.reveal}
        fillerRows={sheet.fillerRows}
        zoom={zoom}
        wrap={sheet.wrap}
        freeze={sheet.freeze}
        restore={restore}
        ready={sheet.ready}
        onSelect={(pos) => dispatch({ type: "select", pos })}
        onOpen={openRow}
        onKeyDown={onGridKey}
        onScrollPos={onScrollPos}
        onTopRow={ref.kind === "chapter" ? onTopRow : undefined}
      />
      <SheetTabs
        tabs={tabs}
        active={book.active}
        onActivate={(tabKey, keyboard) => {
          keepTabFocus.current = keyboard && tabKey !== book.active;
          dispatch({ type: "activate", key: tabKey });
        }}
        onClose={(tabKey) => dispatch({ type: "close", key: tabKey })}
        onAdd={openPalette}
        labels={{ list: "Sheets", previous: t("Previous sheet"), next: t("Next sheet"), add: t("Show and run commands") }}
      />
      <SheetStatusBar
        left={
          <StatusMessage
            crawls={crawls}
            crawlError={crawlError}
            onDismissError={clearCrawlError}
            notice={notice}
          />
        }
        paging={paging}
        summary={selectionSummary(selected, ref.kind === "chapter")}
        zoom={zoom}
        onZoom={(delta) => setZoom((current) => Math.min(200, Math.max(50, current + delta)))}
        zoomLabels={{ out: t("Zoom out"), in: t("Zoom in") }}
        views={views}
      />
      <AppMenu
        anchor={ribbonMenu.menu?.anchor ?? null}
        entries={ribbonMenu.menu?.id === "View" ? viewMenu : fileMenu}
        onClose={ribbonMenu.close}
        tone="sheet"
        label={ribbonMenu.menu?.id ?? ""}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={allCommands}
        placeholder={t("Type a command")}
        tone="sheet"
      />
    </div>
  );
}
