import { KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChapterText, useChapterLines } from "../../hooks/useChapterLines";
import { CrawlLogLine, LiveCrawl } from "../../hooks/useCrawlJob";
import { useStoryChapters } from "../../hooks/useStoryChapters";
import { useStoryList } from "../../hooks/useStoryList";
import { useLang } from "../../i18n";
import { fetchChapterContent, fetchStory, startStoryCrawl, stopStoryCrawl } from "../../lib/api";
import { chapterLines, withoutTitleHeading, wordCount } from "../../lib/skins/chapterLines";
import { readSkinPosition, writeSkinPosition } from "../../lib/skins/position";
import { chapterFileName, storyFolderName } from "../../lib/skins/slug";
import { requestStealthToggle } from "../../lib/ui/stealth";
import { StoredStory } from "../../types";
import { AppMenu, MenuEntry } from "../AppMenu";
import { logText, stripUrls } from "../../lib/skins/crawlLog";
import { CommandPalette, PaletteCommand } from "../CommandPalette";
import { TERM_ICON } from "../registry";
import { useCrawlVersions } from "../../hooks/useCrawlVersions";
import { SkinAppContext } from "../types";
import { useAppMenuEntries, useMenuState } from "../useAppMenu";
import { useSkinCommands } from "../useSkinCommands";
import { COMMAND_NAMES, FileTarget, OutLine, Plan, PlanContext, fileProblem, historyLines, planCommand } from "./commands";
import { complete } from "./complete";
import { etaText, estimatedSize, lastLogin, lsGrid, progressBar, wcLine } from "./format";
import {
  DirNode,
  FileEntry,
  FsView,
  LIBRARY,
  adjacentFile,
  chapterState,
  dirBase,
  dirPath,
  listDir,
  resolvePath,
  resumeFile,
  uniqueNames,
} from "./fs";
import { DEFAULT_FONT_SIZE, FONT_KEY, readFontSize, stepFontSize, windowAction } from "./keys";
import { Pager } from "./Pager";
import { PromptLine, ScrollLine, Scrollback } from "./Scrollback";
import { parseLine } from "./shellParse";
import { TermTitleBar } from "./TermChrome";
import { termCommands } from "./termCommands";
import { FILE_WIDTH, fileBytes, fileRows, fileWidth } from "./text";
import { useTermSize } from "./useTermSize";

// Lines the scrollback keeps, as a terminal profile's scrollback limit does.
const MAX_LINES = 5000;
const HISTORY_LIMIT = 200;
// A download that never showed up on the live channel is taken as finished after this.
const UNSEEN_SYNC_MS = 10000;
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "") ? "⌘" : "Ctrl";

interface PagerState {
  storyId: string;
  order: number;
  line: number;
  fileIndex: { at: number; of: number } | null;
}

interface SyncJob {
  storyId: string;
  background: boolean;
  number: number;
  // Whether the live channel has shown the download yet.
  seen: boolean;
  since: number;
  total: number;
}

const out = (text: string, tone?: "error" | "dim" | "accent"): Omit<ScrollLine, "id"> => ({ line: { kind: "text", text, tone } });
const lineOf = (line: OutLine): Omit<ScrollLine, "id"> => ({ line });

/**
 * The terminal skin: a shell in a terminal window. The library is ~/projects, each story
 * a folder, each chapter a Markdown file; `ls`, `cd`, `cat`, `head`/`tail` work on them,
 * `less` reads one a screen at a time (the main reading mode), `sync` downloads the rest
 * with the progress printed as it goes. Everything the skin does not draw (adding
 * stories, export, settings, narration) is in the palette (F1, Ctrl/Cmd+Shift+P, the
 * search button) and the ⋯ menu.
 */
export default function TermShell({ app }: { app: SkinAppContext }) {
  const { t } = useLang();
  const { job, live, attach, setHead, isPrivate, neutralNames: neutral, openInDefault, openSettings } = app;

  // ---- The library and its names ---------------------------------------------------

  const { stories, loading: listLoading, error: listError, reload: reloadStories } = useStoryList(live);
  const names = useMemo(() => {
    const list = uniqueNames(stories.map((story, index) => storyFolderName(story.title, index, neutral)));
    return {
      byId: new Map(stories.map((story, index) => [story.id, list[index]])),
      byName: new Map(stories.map((story, index) => [list[index], story.id])),
    };
  }, [stories, neutral]);
  const storyIds = useMemo(() => stories.map((story) => story.id), [stories]);
  const updatedAt = useMemo(() => new Map(stories.map((story) => [story.id, story.updatedAt])), [stories]);
  const chapterCounts = useMemo(() => new Map(stories.map((story) => [story.id, story.chapterCount])), [stories]);

  // ---- Session state ---------------------------------------------------------------

  const nextId = useRef(1);
  const [lines, setLines] = useState<ScrollLine[]>(() => [{ id: 0, line: { kind: "text", text: lastLogin(new Date()) } }]);
  const [cwd, setCwd] = useState<DirNode>(LIBRARY);
  const [previous, setPrevious] = useState<DirNode | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [input, setInput] = useState({ value: "", caret: 0 });
  const [historyAt, setHistoryAt] = useState<number | null>(null);
  const draft = useRef("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pager, setPager] = useState<PagerState | null>(null);
  const [pagerNotice, setPagerNotice] = useState<{ id: number; text: string } | null>(null);
  const [fontSize, setFontSize] = useState(readFontSize);
  const [palette, setPalette] = useState<"commands" | "files" | null>(null);
  const [cache, setCache] = useState<Record<string, { story: StoredStory; version: number }>>({});
  // Real sizes of the files opened this session, by "storyId:order".
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [sync, setSync] = useState<SyncJob | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  // A new session (start, exit, neutral names switched) greets once the library is in.
  const [session, setSession] = useState(0);
  const greet = useRef(true);
  const versions = useCrawlVersions(live);

  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const jobNumbers = useRef(0);
  const logMark = useRef<CrawlLogLine | null>(null);
  const lastLive = useRef<LiveCrawl | null>(null);
  const term = useTermSize(body, fontSize);
  // Latest values for callbacks that run after an await.
  const historyRef = useRef(history);
  historyRef.current = history;
  const versionsRef = useRef(versions);
  versionsRef.current = versions;
  const jobLog = useRef(job.log);
  jobLog.current = job.log;

  const append = useCallback((items: Omit<ScrollLine, "id">[]) => {
    if (items.length === 0) return;
    setLines((current) => {
      const next = [...current, ...items.map((item) => ({ ...item, id: nextId.current++ }))];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  // ---- Folders and files -----------------------------------------------------------

  const cwdStoryId = cwd.kind === "story" ? cwd.storyId : null;
  const pagerStoryId = pager?.storyId ?? null;
  const cwdData = useStoryChapters(cwdStoryId, live);
  const pagerData = useStoryChapters(pagerStoryId && pagerStoryId !== cwdStoryId ? pagerStoryId : null, live);
  // `sync <folder>` of another folder: its file names, for the log.
  const syncStoryId = sync && sync.storyId !== cwdStoryId && sync.storyId !== pagerStoryId ? sync.storyId : null;
  const syncData = useStoryChapters(syncStoryId, live);
  // The live channel follows one story: the one downloading here, else the one open.
  const followed = sync?.storyId ?? pagerStoryId ?? cwdStoryId;
  useEffect(() => (followed ? attach("terminal", followed) : undefined), [attach, followed]);

  const storyOf = useCallback(
    (id: string): StoredStory | null => {
      if (id === cwdStoryId && cwdData.story) return cwdData.story;
      if (id === pagerStoryId && pagerData.story) return pagerData.story;
      if (id === syncStoryId && syncData.story) return syncData.story;
      const cached = cache[id];
      return cached && cached.version === (versions[id] ?? 0) ? cached.story : null;
    },
    [cwdStoryId, cwdData.story, pagerStoryId, pagerData.story, syncStoryId, syncData.story, cache, versions]
  );

  const entriesOf = useCallback(
    (story: StoredStory): FileEntry[] => {
      const overlay = story.id === followed ? job.chapters : undefined;
      return story.chapters.map((chapter) => ({
        order: chapter.order,
        name: chapterFileName(chapter.order, chapter.title, neutral),
        state: chapterState(chapter, overlay),
        error: chapter.error,
      }));
    },
    [followed, job.chapters, neutral]
  );

  const view = useMemo<FsView>(() => {
    const memo = new Map<string, FileEntry[] | null>();
    return {
      dirName: (id) => names.byId.get(id),
      storyByName: (name) => names.byName.get(name),
      files: (id) => {
        if (!memo.has(id)) {
          const story = storyOf(id);
          memo.set(id, story ? entriesOf(story) : null);
        }
        return memo.get(id)!;
      },
    };
  }, [names, storyOf, entriesOf]);

  // A folder removed meanwhile (the story deleted in the normal view) is left for home.
  useEffect(() => {
    if (listLoading || listError) return;
    if (cwd.kind === "story" && !names.byId.has(cwd.storyId)) setCwd(LIBRARY);
    if (pager && !names.byId.has(pager.storyId)) setPager(null);
  }, [listLoading, listError, names, cwd, pager]);

  const path = dirPath(cwd, view);
  const fileName = useCallback(
    (storyId: string, order: number) =>
      view.files(storyId)?.find((file) => file.order === order)?.name ?? chapterFileName(order, "", neutral),
    [view, neutral]
  );

  // ---- The pager's file ------------------------------------------------------------

  const pagerVersion = pagerStoryId ? (versions[pagerStoryId] ?? 0) : 0;
  const chapterText = useChapterLines(pagerStoryId, pager?.order ?? null, pagerVersion);
  // A chapter re-read after its download keeps its old text on screen until the new one
  // is in, so the reader is not thrown back to the top.
  const lastText = useRef<{ key: string; text: ChapterText } | null>(null);
  const textKey = pager ? `${pager.storyId}:${pager.order}` : null;
  if (chapterText.text && textKey) lastText.current = { key: textKey, text: chapterText.text };
  const textValue =
    chapterText.text ?? (!chapterText.error && textKey && lastText.current?.key === textKey ? lastText.current.text : null);
  const width = fileWidth(term.columns);
  const pagerRows = useMemo(() => (textValue ? fileRows(textValue.lines, width) : null), [textValue, width]);

  useEffect(() => {
    if (!textValue || !textKey) return;
    const bytes = fileBytes(fileRows(textValue.lines, FILE_WIDTH));
    setSizes((current) => (current[textKey] === bytes ? current : { ...current, [textKey]: bytes }));
  }, [textValue, textKey]);

  const openPager = useCallback(
    (storyId: string, order: number, options: { line?: number; fileIndex?: PagerState["fileIndex"] } = {}) => {
      const saved = readSkinPosition(storyId, isPrivate);
      const line = options.line ?? (saved && saved.order === order ? saved.line : 0);
      writeSkinPosition(storyId, isPrivate, { order, line });
      setPagerNotice(null);
      setPager({ storyId, order, line, fileIndex: options.fileIndex ?? null });
    },
    [isPrivate]
  );

  const notify = useCallback(
    (text: string) => {
      if (pager) setPagerNotice({ id: Date.now(), text });
      else append([out(text, "dim")]);
    },
    [pager, append]
  );

  const stepFile = useCallback(
    (direction: 1 | -1) => {
      if (!pager) return;
      const files = view.files(pager.storyId);
      if (!files) return;
      const next = adjacentFile(files, pager.order, direction);
      if (next.ok) openPager(pager.storyId, next.order, { line: 0, fileIndex: { at: next.at, of: next.of } });
      else if (next.reason === "pending") notify(t("Not downloaded yet."));
      else notify(direction === 1 ? t("Nothing later.") : t("Nothing earlier."));
    },
    [pager, view, openPager, notify, t]
  );

  const quitPager = useCallback(() => {
    setPager(null);
    setFocusToken((n) => n + 1);
  }, []);

  const onTopLine = useCallback(
    (line: number) => {
      if (pager) writeSkinPosition(pager.storyId, isPrivate, { order: pager.order, line });
    },
    [pager, isPrivate]
  );

  // ---- Running commands ------------------------------------------------------------

  // What the planner sees: the latest render's state, plus folders loaded meanwhile.
  const latest = useRef({ cwd, previous, view, storyIds, columns: term.columns, live, sizes, updatedAt, chapterCounts });
  latest.current = { cwd, previous, view, storyIds, columns: term.columns, live, sizes, updatedAt, chapterCounts };

  const contextWith = useCallback(
    (extra: Map<string, StoredStory>): PlanContext => {
      const now = latest.current;
      const files = (id: string) => {
        const story = extra.get(id);
        return story ? entriesOf(story) : now.view.files(id);
      };
      return {
        cwd: now.cwd,
        previous: now.previous,
        view: { ...now.view, files },
        storyIds: now.storyIds,
        columns: now.columns,
        now: new Date(),
        crawling: (id) => !!now.live[id],
        sizeOf: (id, file) => (file.state !== "done" ? 0 : (now.sizes[`${id}:${file.order}`] ?? estimatedSize(id, file.order))),
        storyDate: (id) => now.updatedAt.get(id) ?? extra.get(id)?.updatedAt,
        fileCount: (id) => now.chapterCounts.get(id) ?? 0,
      };
    },
    [entriesOf]
  );

  const readFile = useCallback(
    async (file: FileTarget) => {
      const chapter = await fetchChapterContent(file.storyId, file.order);
      const all = chapterLines(chapter.blocks ?? []);
      const text = neutral ? withoutTitleHeading(all) : all;
      const bytes = fileBytes(fileRows(text, FILE_WIDTH));
      setSizes((current) => ({ ...current, [`${file.storyId}:${file.order}`]: bytes }));
      return { text, bytes };
    },
    [neutral]
  );

  const runRead = async (plan: Extract<Plan, { type: "read" }>) => {
    const printed: Omit<ScrollLine, "id">[] = plan.before.map(lineOf);
    const totals = { lines: 0, words: 0, bytes: 0 };
    const headers = plan.files.length > 1 && (plan.mode === "head" || plan.mode === "tail");
    for (const [index, file] of plan.files.entries()) {
      try {
        const { text, bytes } = await readFile(file);
        if (plan.mode === "wc") {
          const counts = { lines: fileRows(text, FILE_WIDTH).length, words: wordCount(text), bytes };
          totals.lines += counts.lines;
          totals.words += counts.words;
          totals.bytes += counts.bytes;
          printed.push(out(wcLine(counts, file.name)));
          continue;
        }
        const rows = fileRows(text, fileWidth(latest.current.columns)).map((row) => row.text);
        const shown = plan.mode === "head" ? rows.slice(0, plan.count) : plan.mode === "tail" ? rows.slice(Math.max(0, rows.length - plan.count)) : rows;
        if (headers) printed.push(...(index > 0 ? [out("")] : []), out(`==> ${file.name} <==`));
        printed.push(...shown.map((row) => out(row)));
      } catch (err) {
        printed.push(out(`${plan.mode}: ${file.name}: ${stripUrls((err as Error).message)}`, "error"));
      }
    }
    if (plan.mode === "wc" && plan.files.length > 1) printed.push(out(wcLine(totals, "total")));
    append(printed);
  };

  const startSync = async (storyId: string, background: boolean) => {
    const running = latest.current.live[storyId];
    let total = running?.total ?? 0;
    if (!running) {
      try {
        total = (await startStoryCrawl(storyId)).total;
      } catch (err) {
        append([out(`sync: ${stripUrls((err as Error).message)}`, "error")]);
        return;
      }
      if (total === 0) {
        append([out(t("Nothing to download."))]);
        return;
      }
    }
    const number = ++jobNumbers.current;
    // Only what the log prints from now on belongs to this run. Following another story
    // empties the log first, and a mark no longer in it means "print it all".
    const log = jobLog.current;
    logMark.current = log[log.length - 1] ?? null;
    lastLive.current = running ?? null;
    setSync({ storyId, background, number, seen: !!running, since: Date.now(), total });
    if (background) append([out(`[${number}] ${41200 + number * 37}`)]);
    else append([out(t("Downloading {count} files…", { count: total }), "dim")]);
  };

  const resetSession = useCallback(() => {
    setLines([{ id: nextId.current++, line: { kind: "text", text: lastLogin(new Date()) } }]);
    setCwd(LIBRARY);
    setPrevious(null);
    setPager(null);
    setSync(null);
    greet.current = true;
    setSession((n) => n + 1);
  }, []);

  const execute = async (plan: Plan) => {
    switch (plan.type) {
      case "print":
        append(plan.lines.map(lineOf));
        return;
      case "cd":
        setPrevious(latest.current.cwd);
        setCwd(plan.to);
        return;
      case "read":
        await runRead(plan);
        return;
      case "pager": {
        if (plan.file) {
          openPager(plan.file.storyId, plan.file.order);
          return;
        }
        const here = latest.current.cwd;
        const files = here.kind === "story" ? latest.current.view.files(here.storyId) : null;
        if (here.kind !== "story" || !files) return;
        const target = resumeFile(files, readSkinPosition(here.storyId, isPrivate));
        if (target) openPager(here.storyId, target.order, { line: target.line });
        else append([out(`less: ${t("Not downloaded yet.")}`, "error")]);
        return;
      }
      case "sync":
        await startSync(plan.storyId, plan.background);
        return;
      case "stop":
        try {
          await stopStoryCrawl(plan.storyId);
          append([out(t("Stopping after the current file."))]);
        } catch (err) {
          append([out(`stop: ${stripUrls((err as Error).message)}`, "error")]);
        }
        return;
      case "open":
        openInDefault(plan.storyId ? { storyId: plan.storyId, order: plan.order } : undefined);
        return;
      case "settings":
        openSettings();
        return;
      case "clear":
        setLines([]);
        return;
      case "exit":
        resetSession();
        return;
      case "hide":
        requestStealthToggle();
        return;
      case "history":
        append(historyLines(historyRef.current).map(lineOf));
        return;
      case "need":
      case "none":
        return;
    }
  };

  const runLine = async (raw: string) => {
    append([{ prompt: { path: dirPath(latest.current.cwd, latest.current.view), input: raw } }]);
    if (raw.trim()) {
      const next = historyRef.current[historyRef.current.length - 1] === raw ? historyRef.current : [...historyRef.current, raw].slice(-HISTORY_LIMIT);
      historyRef.current = next;
      setHistory(next);
    }
    const parsed = parseLine(raw);
    if (parsed.name === "ls" || parsed.name === "ll") {
      if (latest.current.cwd.kind === "library" && listError) {
        append([out(`ls: ${stripUrls(listError)}`, "error")]);
        void reloadStories();
        return;
      }
    }
    setBusy(true);
    try {
      const extra = new Map<string, StoredStory>();
      let plan = planCommand(parsed, contextWith(extra), t);
      for (let tries = 0; plan.type === "need" && tries < 3; tries++) {
        const id = plan.storyId;
        try {
          const story = await fetchStory(id);
          extra.set(id, story);
          setCache((current) => ({ ...current, [id]: { story, version: versionsRef.current[id] ?? 0 } }));
        } catch (err) {
          append([out(`${parsed.name}: ${stripUrls((err as Error).message)}`, "error")]);
          return;
        }
        plan = planCommand(parsed, contextWith(extra), t);
      }
      await execute(plan);
    } finally {
      setBusy(false);
      stick.current = true;
    }
  };

  // ---- The download running in the foreground (or as a background job) ---------------

  const syncFiles = useMemo(() => {
    const story = sync ? storyOf(sync.storyId) : null;
    return new Map((story?.chapters ?? []).map((chapter) => [chapter.url, chapterFileName(chapter.order, chapter.title, neutral)]));
  }, [sync, storyOf, neutral]);

  // The log streams into the scrollback while the download runs in the foreground, its
  // addresses turned into file names (a story's address must never be printed).
  useEffect(() => {
    if (!sync || sync.background || followed !== sync.storyId) return;
    const log = job.log;
    const mark = logMark.current;
    const from = mark ? log.lastIndexOf(mark) + 1 : 0;
    const fresh = log.slice(from);
    if (fresh.length === 0) return;
    logMark.current = log[log.length - 1];
    append(
      fresh.map((line) => out(logText(line.text, (url) => syncFiles.get(url) ?? null), line.isError ? "error" : undefined))
    );
  }, [job.log, sync, followed, syncFiles, append]);

  const syncLive = sync ? live[sync.storyId] : undefined;
  const finishSync = useCallback(
    (run: SyncJob) => {
      const last = lastLive.current;
      const done = last ? last.total : run.total;
      const errors = last?.errors ?? 0;
      if (run.background) {
        append([out(`[${run.number}]  + ${errors > 0 ? "exit 1" : "done  "}     sync`)]);
      } else {
        append([out(progressBar(done, done || run.total))]);
        if (errors > 0) append([out(t("Download errors: {count}", { count: errors }), "error")]);
      }
      setSync(null);
    },
    [append, t]
  );

  useEffect(() => {
    if (!sync) return;
    if (syncLive) {
      lastLive.current = syncLive;
      if (!sync.seen) setSync({ ...sync, seen: true });
      return;
    }
    if (sync.seen) {
      finishSync(sync);
      return;
    }
    const timer = window.setTimeout(() => finishSync(sync), Math.max(0, sync.since + UNSEEN_SYNC_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [sync, syncLive, finishSync]);

  // ---- Shared commands, crawl errors, the tab --------------------------------------

  const { commands, crawlError, clearCrawlError } = useSkinCommands(app, {
    storyId: pager?.storyId ?? cwdStoryId,
    order: pager?.order ?? null,
  });

  useEffect(() => {
    if (!crawlError) return;
    append([out(`sync: ${stripUrls(crawlError)}`, "error")]);
    if (pager) setPagerNotice({ id: Date.now(), text: `sync: ${stripUrls(crawlError)}` });
    clearCrawlError();
  }, [crawlError]); // eslint-disable-line react-hooks/exhaustive-deps

  // Neutral names switched on mid-session: nothing printed under the old names stays.
  const neutralBefore = useRef(neutral);
  useEffect(() => {
    if (neutralBefore.current === neutral) return;
    neutralBefore.current = neutral;
    resetSession();
  }, [neutral, resetSession]);

  // A session's first words, once the library is in: how to get help, and an empty or
  // unreadable library said plainly.
  useEffect(() => {
    if (listLoading || !greet.current) return;
    greet.current = false;
    append([
      ...(listError ? [out(`zsh: ${stripUrls(listError)}`, "error")] : []),
      ...(!listError && stories.length === 0 ? [out(t("This workspace has no folders yet. Add them in the normal view."), "dim")] : []),
      out(t('Type "help" to see the commands.'), "dim"),
    ]);
  }, [listLoading, listError, stories.length, session, append, t]);

  const pagerName = pager ? fileName(pager.storyId, pager.order) : null;
  const foreground = !!sync && !sync.background;
  const title = pagerName ? `less ${pagerName}` : foreground ? `sync — dev@workstation: ${path}` : `dev@workstation: ${path}`;
  const process = pager ? "less" : foreground ? "sync" : "zsh";

  useEffect(() => {
    setHead({ title, favicon: TERM_ICON });
  }, [setHead, title]);
  useEffect(() => () => setHead(null), [setHead]);

  useEffect(() => {
    try {
      localStorage.setItem(FONT_KEY, String(fontSize));
    } catch {
      /* Not remembered */
    }
  }, [fontSize]);

  // ---- Keys and focus ----------------------------------------------------------------

  const zoom = useCallback((step: 1 | -1 | 0) => setFontSize((size) => (step === 0 ? DEFAULT_FONT_SIZE : stepFontSize(size, step))), []);
  const actions = useRef({ palette: () => setPalette("commands"), zoom });
  actions.current = { palette: () => setPalette("commands"), zoom };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("[data-stealth-decoy]")) return;
      const target = event.target instanceof Node ? event.target : null;
      const loose = !target || target === document.body;
      const inside = loose || !!root.current?.contains(target);
      if (!inside) return;
      const action = windowAction(event);
      if (!action) {
        // Focus fell to the page (a dialog closed): typing goes to the terminal again, as
        // in a terminal window. Moved during keydown, the key itself lands there too.
        if (loose && !["Shift", "Control", "Alt", "Meta", "Tab", "Escape"].includes(event.key)) {
          const pagerElement = root.current?.querySelector<HTMLElement>("[data-term-pager]");
          (pagerElement ?? field.current)?.focus({ preventScroll: true });
        }
        return;
      }
      event.preventDefault();
      if (action === "palette") actions.current.palette();
      else actions.current.zoom(action === "zoomIn" ? 1 : action === "zoomOut" ? -1 : 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The prompt takes the keys at the start, after the pager closes and after the palette —
  // unless something outside the terminal (the settings) has taken focus meanwhile.
  useEffect(() => {
    if (palette || pager) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && !root.current?.contains(active)) return;
      field.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [palette, pager, focusToken, listLoading]);

  // The caret drawn follows the real one, also after history or completion moved it.
  useLayoutEffect(() => {
    const element = field.current;
    if (element && document.activeElement === element && element.selectionStart !== input.caret) {
      element.setSelectionRange(input.caret, input.caret);
    }
  }, [input]);

  // New output keeps the prompt in view, unless the reader scrolled up to look back.
  useLayoutEffect(() => {
    const element = body.current;
    if (element && stick.current && !pager) element.scrollTop = element.scrollHeight;
  }, [lines, input, busy, sync, pager, term.rows]);

  const listFor = (dirPart: string) => {
    const now = latest.current;
    const resolved = resolvePath(now.cwd, dirPart || ".", now.view);
    if (!resolved.ok || resolved.node.kind === "file") return null;
    return listDir(resolved.node, now.view, now.storyIds);
  };

  const onPromptKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const { value } = input;
    // Ctrl alone: Ctrl+Shift chords stay the app's (private mode) and the browser's.
    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    if (ctrl && event.code === "KeyC") {
      // With text selected, Ctrl+C copies; otherwise it interrupts, as in a terminal.
      if (window.getSelection()?.toString()) return;
      event.preventDefault();
      if (sync && !sync.background) {
        // The download stops after the file it is on; the prompt is back at once.
        const run = sync;
        setSync(null);
        append([out(`${progressBar(syncLive?.cursor ?? 0, syncLive?.total ?? run.total)}^C`)]);
        stopStoryCrawl(run.storyId).catch((err: Error) => append([out(`sync: ${stripUrls(err.message)}`, "error")]));
      } else {
        append([{ prompt: { path, input: `${value}^C` } }]);
      }
      setInput({ value: "", caret: 0 });
      setHistoryAt(null);
      return;
    }
    if (foreground || busy) {
      // A running program has the terminal; Enter waits, as typed-ahead keys do.
      if (event.key === "Enter" || event.key === "Tab") event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      setInput({ value: "", caret: 0 });
      setHistoryAt(null);
      void runLine(value);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (input.caret < value.length) return;
      const result = complete(value, { commands: COMMAND_NAMES, list: listFor });
      if (result.input !== value) setInput({ value: result.input, caret: result.input.length });
      if (result.candidates.length > 0) {
        const shown = result.candidates.slice(0, 200);
        const grid = lsGrid(
          shown.map((name) => ({ name, tone: name.endsWith("/") ? ("dir" as const) : ("file" as const) })),
          latest.current.columns
        );
        append([{ prompt: { path, input: value } }, ...grid.map((cells) => lineOf({ kind: "grid", cells }))]);
        if (result.candidates.length > shown.length) append([out(`… +${result.candidates.length - shown.length}`, "dim")]);
      }
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (history.length === 0) return;
      const at = historyAt ?? history.length;
      if (historyAt === null) draft.current = value;
      const next = Math.min(history.length, Math.max(0, at + (event.key === "ArrowUp" ? -1 : 1)));
      const text = next >= history.length ? draft.current : history[next];
      setHistoryAt(next >= history.length ? null : next);
      setInput({ value: text, caret: text.length });
      return;
    }
    if (!ctrl) return;
    // The line editor's own keys (emacs bindings, as zsh has them).
    const caret = input.caret;
    const edits: Record<string, () => { value: string; caret: number } | null> = {
      KeyA: () => ({ value, caret: 0 }),
      KeyE: () => ({ value, caret: value.length }),
      KeyU: () => ({ value: value.slice(caret), caret: 0 }),
      KeyK: () => ({ value: value.slice(0, caret), caret }),
      KeyL: () => {
        setLines([]);
        return null;
      },
      KeyD: () => {
        if (value === "") resetSession();
        return null;
      },
    };
    const edit = edits[event.code];
    if (!edit) return;
    event.preventDefault();
    const next = edit();
    if (next) setInput(next);
  };

  // ---- Palette and menu --------------------------------------------------------------

  const menu = useMenuState<"main">();
  const openHere = useCallback(() => {
    if (pager) openInDefault({ storyId: pager.storyId, order: pager.order });
    else openInDefault(cwdStoryId ? { storyId: cwdStoryId } : undefined);
  }, [pager, cwdStoryId, openInDefault]);
  const appEntries = useAppMenuEntries({ openInDefault: openHere, openSettings });
  const menuEntries = useMemo<MenuEntry[]>(
    () => [
      { kind: "item", id: "palette", label: t("Show and run commands"), hint: "F1", run: () => setPalette("commands") },
      { kind: "separator", id: "palette-sep" },
      ...appEntries,
    ],
    [appEntries, t]
  );

  // A palette pick runs as if typed at the prompt, so the scrollback shows what happened.
  const runLineRef = useRef(runLine);
  runLineRef.current = runLine;
  const typeCommand = useCallback((command: string) => {
    setPager(null);
    void runLineRef.current(command);
  }, []);

  const ownCommands = termCommands(
    {
      pagerOpen: !!pager,
      stepFile,
      quitPager,
      goToFile: () => setPalette("files"),
      clear: () => setLines([]),
      zoom,
      mod: MOD,
    },
    t
  );

  // "Go to file…": the folders or files where the shell is (or of the file being read).
  const fileCommands = useMemo<PaletteCommand[]>(() => {
    if (palette !== "files") return [];
    const dir: DirNode = pager ? { kind: "story", storyId: pager.storyId } : cwd;
    const entries = listDir(dir, view, storyIds) ?? [];
    const files = dir.kind === "story" ? (view.files(dir.storyId) ?? []) : [];
    return entries.map((entry) => {
      const node = entry.node;
      const file = node.kind === "file" ? files.find((item) => item.order === node.order) : undefined;
      return {
        id: `file-${entry.name}`,
        label: entry.dir ? `${entry.name}/` : entry.name,
        hint: dirBase(dir, view),
        run: () => {
          if (node.kind !== "file") typeCommand(`cd ${entry.name}`);
          else if (file && file.state !== "done") notify(fileProblem(file, t) ?? "");
          else openPager(node.storyId, node.order);
        },
      };
    });
  }, [palette, pager, cwd, view, storyIds, openPager, notify, typeCommand, t]);

  // ---- Drawing -----------------------------------------------------------------------

  const followedLive = followed ? live[followed] : undefined;
  const rightPrompt = followedLive && !foreground ? `⇣ ${followedLive.cursor}/${followedLive.total}` : null;
  const syncBar = foreground ? progressBar(syncLive?.cursor ?? 0, syncLive?.total ?? sync!.total) : null;
  const syncEta = foreground ? etaText(syncLive?.etaMs) : "";

  return (
    <div ref={root} className="flex h-full flex-col overflow-hidden bg-term-bg font-term text-term-fg">
      <TermTitleBar
        title={title}
        process={process}
        size={`${term.columns}×${term.rows}`}
        onPalette={() => setPalette("commands")}
        onMenu={(element) => menu.open("main", element)}
      />
      <div
        ref={body}
        role="region"
        aria-label={t("Terminal")}
        className={`min-h-0 flex-1 px-3 py-1.5 selection:bg-term-select ${pager ? "overflow-hidden" : "overflow-y-auto"}`}
        style={{ fontSize, lineHeight: `${term.lineHeight}px` }}
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < term.lineHeight * 2;
        }}
        onMouseUp={() => {
          if (!pager && window.getSelection()?.isCollapsed !== false) field.current?.focus({ preventScroll: true });
        }}
      >
        {pager && pagerName ? (
          <Pager
            key={`${pager.storyId}:${pager.order}`}
            name={pagerName}
            rows={pagerRows}
            error={chapterText.error ? stripUrls(chapterText.error) : null}
            initialLine={pager.line}
            fileIndex={pager.fileIndex}
            notice={pagerNotice}
            screenRows={term.rows}
            lineHeight={term.lineHeight}
            focusToken={focusToken}
            onTopLine={onTopLine}
            onQuit={quitPager}
            onFile={stepFile}
          />
        ) : (
          <>
            <Scrollback lines={lines} />
            {syncBar && (
              <div className="whitespace-pre-wrap break-all text-term-cyan">
                {syncBar}
                {syncEta && <span className="text-term-dim">{`  eta ${syncEta}`}</span>}
              </div>
            )}
            {listLoading && lines.length <= 1 ? null : (
              <PromptLine
                path={path}
                value={input.value}
                caret={input.caret}
                focused={focused}
                showPrompt={!foreground && !busy}
                right={rightPrompt}
                label={t("Terminal input")}
                inputRef={field}
                onChange={(value, caret) => {
                  setInput({ value, caret });
                  setHistoryAt(null);
                }}
                onCaret={(caret) => setInput((current) => (current.caret === caret ? current : { ...current, caret }))}
                onKeyDown={onPromptKey}
                onFocusChange={setFocused}
              />
            )}
          </>
        )}
      </div>
      <AppMenu anchor={menu.menu?.anchor ?? null} entries={menuEntries} onClose={menu.close} tone="term" label={t("Terminal menu")} />
      <CommandPalette
        open={palette !== null}
        onClose={() => {
          setPalette(null);
          setFocusToken((n) => n + 1);
        }}
        commands={palette === "files" ? fileCommands : [...ownCommands, ...commands]}
        placeholder={palette === "files" ? t("Search files by name") : t("Type a command")}
        tone="term"
      />
    </div>
  );
}
