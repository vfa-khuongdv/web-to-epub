import { BookMarked, ChartLine, CircleDot, CirclePlay, Code, GitPullRequest, Hexagon, Package, Settings, Shield, Table2, Users } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChapterText, useChapterLines } from "../../hooks/useChapterLines";
import { useStoryChapters } from "../../hooks/useStoryChapters";
import { useStoryList } from "../../hooks/useStoryList";
import { useLang } from "../../i18n";
import { readSkinPosition, writeSkinPosition } from "../../lib/skins/position";
import { chapterFileName, storyFolderName } from "../../lib/skins/slug";
import { AppMenu, MenuEntry } from "../AppMenu";
import { CommandPalette, PaletteCommand } from "../CommandPalette";
import { stripUrls } from "../../lib/skins/crawlLog";
import { REPO_ICON } from "../registry";
import { adjacentChapter, shownStatus, sortChapters } from "../../lib/skins/chapters";
import { useCrawlVersions } from "../../hooks/useCrawlVersions";
import { SkinAppContext } from "../types";
import { useAppMenuEntries, useMenuState } from "../useAppMenu";
import { useSkinCommands } from "../useSkinCommands";
import { ActionsTab } from "./ActionsTab";
import { BlobMode, BlobView, FileLink } from "./BlobView";
import { CodeTab, FileEntry } from "./CodeTab";
import { SettingsTab } from "./EmptyTabs";
import { FileTreePanel, TreeFile } from "./FileTreePanel";
import { Avatar, BTN_SM, Blankslate, Flash, GlobalHeader, Label, NavTab, Spinner, Toast, UnderlineNav } from "./RepoChrome";
import { KeyAction, keyAction } from "./repoKeys";
import { RepoEntry, RepoList } from "./RepoList";
import { FILES_PER_PAGE, ORG, RepoTab, TitledItem, descriptionKey, fileTime, pageOf, pageTitle, rawRows, shortSha } from "./repoModel";
import { DOCS_PULL, docsPull } from "./pr/docsPull";
import { fakeRepository } from "./pr/fakeData";
import { IssuePage } from "./pr/IssuePage";
import { ItemList } from "./pr/ItemList";
import { PullRequestPage } from "./pr/PullRequestPage";
import { issueRow, newestFirst, pullRow } from "./pr/rows";
import { LinkedItems } from "./pr/Sidebar";
import { IssueState, PrState } from "./pr/state";
import { currentRun, logRows, runNumber } from "./runLog";

type View =
  | { kind: "home" }
  | { kind: "repo"; storyId: string; tab: RepoTab }
  | { kind: "blob"; storyId: string; order: number }
  | { kind: "pull"; storyId: string; number: number }
  | { kind: "issue"; storyId: string; number: number };

const MODE_KEY = "repo-blob-mode";
const TREE_KEY = "repo-tree-open";
const PULLS_QUERY = "is:pr is:open";
const ISSUES_QUERY = "is:issue is:open";
const NOTICE_MS = 4000;
// How long a "g" waits for its letter, as on the site.
const CHORD_MS = 1500;

type RepoNavId = RepoTab | "projects" | "security" | "insights";

const REPO_TABS: NavTab<RepoNavId>[] = [
  { id: "code", label: "Code", icon: <Code size={16} /> },
  { id: "issues", label: "Issues", icon: <CircleDot size={16} /> },
  { id: "pulls", label: "Pull requests", icon: <GitPullRequest size={16} /> },
  { id: "actions", label: "Actions", icon: <CirclePlay size={16} /> },
  { id: "projects", label: "Projects", icon: <Table2 size={16} />, inert: true },
  { id: "security", label: "Security", icon: <Shield size={16} />, inert: true },
  { id: "insights", label: "Insights", icon: <ChartLine size={16} />, inert: true },
  { id: "settings", label: "Settings", icon: <Settings size={16} /> },
];

const TAB_KEYS: Record<RepoTab, string> = { code: "g c", issues: "g i", pulls: "g p", actions: "g a", settings: "g s" };

function readTreeOpen(): boolean {
  try {
    return localStorage.getItem(TREE_KEY) !== "0";
  } catch {
    return true;
  }
}

function readMode(): BlobMode {
  try {
    return localStorage.getItem(MODE_KEY) === "code" ? "code" : "preview";
  } catch {
    return "preview";
  }
}

function isTyping(target: HTMLElement): boolean {
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "SELECT" || tag === "TEXTAREA") return true;
  return tag === "INPUT" && !(target as HTMLInputElement).readOnly;
}

/**
 * The code-hosting skin: the library as a team's repositories, a story as a repository
 * whose files are its chapters, and a chapter read as a Markdown file (rendered, or as
 * numbered source), with the file tree beside it. The download is the repository's
 * workflow run. Issues and pull requests are the team's made-up work (pr/fakeData.ts) on
 * working pages — comments, reviews, merges, all kept in memory for the session — plus one
 * real-looking pull request: the newest downloaded file, readable on Files changed as added
 * lines. Everything else — adding, export, settings, the looks — is in the avatar menu
 * and the command palette ("/", "s", Ctrl/Cmd+K, or the search box).
 */
export default function RepoShell({ app }: { app: SkinAppContext }) {
  const { t } = useLang();
  const { live, job, attach, setHead, isPrivate, neutralNames: neutral, openInDefault, openSettings } = app;
  const [view, setView] = useState<View>({ kind: "home" });
  const [repoQuery, setRepoQuery] = useState("");
  const [homePage, setHomePage] = useState(0);
  const [fileQuery, setFileQuery] = useState("");
  // The file-table page per repository, so coming back lands where it was.
  const [filePages, setFilePages] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<BlobMode>(readMode);
  const [treeOpen, setTreeOpen] = useState(readTreeOpen);
  // The team's made-up issues and pull requests, the same in every repository; what is
  // done on them (comments, reviews, merges) is kept per repository for this session.
  const [fake] = useState(() => fakeRepository(Date.now()));
  const prStore = useRef(new Map<string, PrState>());
  const issueStore = useRef(new Map<string, IssueState>());
  // A page's change (a merge, a closed issue) redraws the counters in the tabs.
  const [, storeChanged] = useReducer((count: number) => count + 1, 0);
  const [pullQuery, setPullQuery] = useState(PULLS_QUERY);
  const [issueQuery, setIssueQuery] = useState(ISSUES_QUERY);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const repoFilter = useRef<HTMLInputElement>(null);
  const fileFilter = useRef<HTMLInputElement>(null);
  // The line a file opens at, set just before the file is shown.
  const startLine = useRef(0);
  // A row to bring back into view (and focus) once the file table is drawn.
  const focusRow = useRef<number | null>(null);
  const focusFilter = useRef(false);
  const menu = useMenuState<"account" | "nav">();

  const storyId = view.kind === "home" ? null : view.storyId;
  const order = view.kind === "blob" ? view.order : null;
  const { stories, loading: listLoading, error: listError, reload: reloadList } = useStoryList(live);
  const storyData = useStoryChapters(storyId, live);
  const versions = useCrawlVersions(live);
  const crawl = storyId ? live[storyId] : undefined;
  const liveStates = crawl ? job.chapters : undefined;

  const entries = useMemo<RepoEntry[]>(
    () => stories.map((story, index) => ({ story, index, name: storyFolderName(story.title, index, neutral) })),
    [stories, neutral]
  );
  const entry = storyId ? (entries.find((candidate) => candidate.story.id === storyId) ?? null) : null;
  const repo = storyId ? (entry?.name ?? storyFolderName("", entries.length, neutral)) : null;
  const description = t(descriptionKey(entry?.index ?? 0));

  const chapters = useMemo(() => (storyData.story ? sortChapters(storyData.story.chapters) : null), [storyData.story]);
  const files = useMemo<FileEntry[] | null>(
    () =>
      chapters
        ? chapters.map((chapter) => ({
            order: chapter.order,
            name: chapterFileName(chapter.order, chapter.title, neutral),
            status: shownStatus(chapter, liveStates),
          }))
        : null,
    [chapters, neutral, liveStates]
  );
  const fileOf = useCallback(
    (fileOrder: number | null): FileLink | null =>
      fileOrder === null
        ? null
        : { order: fileOrder, name: files?.find((file) => file.order === fileOrder)?.name ?? chapterFileName(fileOrder, "", neutral) },
    [files, neutral]
  );

  // ---- The open file -------------------------------------------------------------

  const chapter = order !== null && chapters ? (chapters.find((candidate) => candidate.order === order) ?? null) : null;
  const status = chapter ? shownStatus(chapter, liveStates) : null;
  const readable = status === "done";
  const chapterText = useChapterLines(readable ? storyId : null, readable ? order : null, storyId ? (versions[storyId] ?? 0) : 0);
  // A file re-read after a download ended keeps its old text until the new one is in,
  // so the reader is not thrown back to the top.
  const lastText = useRef<{ key: string; text: ChapterText } | null>(null);
  const textKey = storyId && order !== null ? `${storyId}:${order}` : null;
  if (chapterText.text && textKey) lastText.current = { key: textKey, text: chapterText.text };
  const text =
    chapterText.text ??
    (readable && !chapterText.error && textKey && lastText.current?.key === textKey ? lastText.current.text : null);
  const previous = useMemo(
    () => (order !== null && chapters ? fileOf(adjacentChapter(chapters, order, -1, liveStates)) : null),
    [order, chapters, liveStates, fileOf]
  );
  const next = useMemo(
    () => (order !== null && chapters ? fileOf(adjacentChapter(chapters, order, 1, liveStates)) : null),
    [order, chapters, liveStates, fileOf]
  );
  const file = fileOf(order);

  // The file tree beside an open file: names only, so a download ticking does not redraw it.
  const treeEntries = useMemo<TreeFile[]>(
    () => (chapters ? chapters.map((chapter) => ({ order: chapter.order, name: chapterFileName(chapter.order, chapter.title, neutral) })) : []),
    [chapters, neutral]
  );

  // ---- Issues and pull requests ----------------------------------------------------------

  // The newest downloaded file is open for review as the shell's own pull request.
  const newestDone = useMemo(() => {
    if (!files) return null;
    for (let index = files.length - 1; index >= 0; index--) if (files[index].status === "done") return files[index];
    return null;
  }, [files]);
  const docsWanted = view.kind === "pull" && view.number === DOCS_PULL && newestDone ? newestDone.order : null;
  const docsText = useChapterLines(docsWanted !== null ? storyId : null, docsWanted, storyId ? (versions[storyId] ?? 0) : 0);
  const docsUpdatedAt = storyData.story?.updatedAt ?? null;
  const docsLastOrder = files && files.length > 0 ? files[files.length - 1].order : 0;
  const docs = useMemo(() => {
    if (!storyId || !newestDone) return null;
    const stamp = docsUpdatedAt ? Date.parse(fileTime(docsUpdatedAt, newestDone.order, docsLastOrder)) : NaN;
    const lines = docsWanted !== null && docsText.text ? rawRows(docsText.text.lines).map((row) => row.text) : [];
    return {
      order: newestDone.order,
      ready: docsWanted !== null && !!docsText.text,
      pr: docsPull({ file: newestDone.name, lines, sha: shortSha(`${storyId}:${newestDone.order}`), at: Number.isNaN(stamp) ? fake.pulls[0].at : stamp }),
    };
  }, [storyId, newestDone, docsWanted, docsText.text, docsUpdatedAt, docsLastOrder, fake]);

  const storeKey = (number: number) => `${storyId}:${number}${number === DOCS_PULL && docs ? `:${docs.order}` : ""}`;
  const pullRows = storyId
    ? newestFirst([...(docs ? [docs.pr] : []), ...fake.pulls].map((pull) => pullRow(pull, prStore.current.get(storeKey(pull.number)))))
    : [];
  const issueRows = storyId ? newestFirst(fake.issues.map((issue) => issueRow(issue, issueStore.current.get(storeKey(issue.number))))) : [];
  const openPullCount = pullRows.filter((row) => row.state === "open").length;
  const openIssueCount = issueRows.filter((row) => row.state === "open").length;
  const openPullData = view.kind === "pull" ? (view.number === DOCS_PULL ? (docs?.pr ?? null) : (fake.pulls.find((pull) => pull.number === view.number) ?? null)) : null;
  const openIssueData = view.kind === "issue" ? (fake.issues.find((issue) => issue.number === view.number) ?? null) : null;
  const item: TitledItem | null = openPullData
    ? { kind: "pull", number: openPullData.number, title: openPullData.title, author: openPullData.author }
    : openIssueData
      ? { kind: "issue", number: openIssueData.number, title: openIssueData.title, author: openIssueData.author }
      : null;

  // ---- Live download, tab head, clock, notices -------------------------------------

  useEffect(() => (storyId ? attach("repository", storyId) : undefined), [attach, storyId]);

  const title = pageTitle({ repo, tab: view.kind === "repo" ? view.tab : undefined, file: file?.name ?? null, item });
  useEffect(() => setHead({ title, favicon: REPO_ICON }), [setHead, title]);
  useEffect(() => () => setHead(null), [setHead]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // ---- Navigation -----------------------------------------------------------------

  const viewRef = useRef(view);
  viewRef.current = view;

  const goHome = useCallback(() => setView({ kind: "home" }), []);

  const openRepo = useCallback((id: string, tab: RepoTab = "code") => {
    const current = viewRef.current;
    if (current.kind === "home" || current.storyId !== id) setFileQuery("");
    setView({ kind: "repo", storyId: id, tab });
  }, []);

  const openItem = useCallback((kind: "pr" | "issue", number: number) => {
    const current = viewRef.current;
    if (current.kind === "home") return;
    setView(kind === "pr" ? { kind: "pull", storyId: current.storyId, number } : { kind: "issue", storyId: current.storyId, number });
  }, []);

  const changeTree = useCallback((open: boolean) => {
    setTreeOpen(open);
    try {
      localStorage.setItem(TREE_KEY, open ? "1" : "0");
    } catch {
      /* Not remembered next time */
    }
  }, []);

  const openFile = useCallback(
    (id: string, fileOrder: number, line?: number) => {
      const saved = readSkinPosition(id, isPrivate);
      const start = line ?? (saved && saved.order === fileOrder ? saved.line : 0);
      startLine.current = start;
      writeSkinPosition(id, isPrivate, { order: fileOrder, line: start });
      setView({ kind: "blob", storyId: id, order: fileOrder });
    },
    [isPrivate]
  );

  const upToList = useCallback(() => {
    const current = viewRef.current;
    if (current.kind !== "blob") return;
    const index = files ? files.findIndex((candidate) => candidate.order === current.order) : -1;
    if (index >= 0) setFilePages((pages) => ({ ...pages, [current.storyId]: pageOf(index, FILES_PER_PAGE) }));
    focusRow.current = current.order;
    setFileQuery("");
    setView({ kind: "repo", storyId: current.storyId, tab: "code" });
  }, [files]);

  const step = useCallback(
    (direction: 1 | -1) => {
      const current = viewRef.current;
      if (current.kind !== "blob") return;
      const to = direction === 1 ? next : previous;
      if (!to) {
        setNotice(direction === 1 ? t("Nothing later.") : t("Nothing earlier."));
        return;
      }
      openFile(current.storyId, to.order, 0);
    },
    [next, previous, openFile, t]
  );

  const findFile = useCallback(() => {
    const current = viewRef.current;
    if (current.kind === "home") return;
    if (current.kind === "repo" && current.tab === "code" && fileFilter.current) {
      fileFilter.current.focus();
      return;
    }
    focusFilter.current = true;
    openRepo(current.storyId, "code");
  }, [openRepo]);

  const changeMode = useCallback((value: BlobMode) => {
    setMode(value);
    try {
      localStorage.setItem(MODE_KEY, value);
    } catch {
      /* Not remembered next time */
    }
  }, []);

  const onTopLine = useCallback(
    (line: number) => {
      const current = viewRef.current;
      if (current.kind === "blob") writeSkinPosition(current.storyId, isPrivate, { order: current.order, line });
    },
    [isPrivate]
  );

  // ---- The file table's page ---------------------------------------------------------

  const lastRead = useMemo(() => {
    if (view.kind !== "repo" || !files) return null;
    const saved = readSkinPosition(view.storyId, isPrivate);
    return saved ? (files.find((candidate) => candidate.order === saved.order) ?? null) : null;
  }, [view, files, isPrivate]);
  const filePage = storyId ? filePages[storyId] : undefined;

  // A repository opened again shows the page holding the file read last.
  useEffect(() => {
    if (view.kind !== "repo" || filePage !== undefined || !files) return;
    const index = lastRead ? files.indexOf(lastRead) : -1;
    setFilePages((pages) => ({ ...pages, [view.storyId]: index >= 0 ? pageOf(index, FILES_PER_PAGE) : 0 }));
  }, [view, filePage, files, lastRead]);

  // ---- Focus and scroll -------------------------------------------------------------

  const viewKey =
    view.kind === "home"
      ? "home"
      : view.kind === "repo"
        ? `repo:${view.storyId}:${view.tab}`
        : view.kind === "blob"
          ? `blob:${view.storyId}:${view.order}`
          : `${view.kind}:${view.storyId}:${view.number}`;
  useLayoutEffect(() => {
    // The file view scrolls itself (to the line it was left at).
    if (view.kind !== "blob" && scroller.current) scroller.current.scrollTop = 0;
  }, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back from a file: its row is shown and focused, so Enter opens it again.
  useLayoutEffect(() => {
    const target = focusRow.current;
    if (target === null || view.kind !== "repo") return;
    const row = scroller.current?.querySelector<HTMLElement>(`[data-file-order="${target}"]`);
    if (!row) return;
    focusRow.current = null;
    row.scrollIntoView({ block: "center" });
    row.querySelector("button")?.focus({ preventScroll: true });
  });

  // The page takes the keys (Space and the arrows scroll it) whenever the view changes or
  // an overlay closes — unless focus went somewhere on purpose, or outside the skin.
  const overlayOpen = paletteOpen || menu.menu !== null;
  useEffect(() => {
    if (overlayOpen) return;
    if (focusFilter.current && fileFilter.current) {
      focusFilter.current = false;
      fileFilter.current.focus();
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body && active !== scroller.current) return;
    scroller.current?.focus({ preventScroll: true });
  }, [viewKey, overlayOpen]);

  // ---- Commands -----------------------------------------------------------------------

  const { commands, crawlError, clearCrawlError } = useSkinCommands(app, { storyId, order });
  const commandRun = useCallback((id: string) => commands.find((command) => command.id === id)?.run, [commands]);
  const download = commandRun("crawl") ?? null;
  const stopDownload = commandRun("stop-crawl") ?? null;

  const own = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [];
    if (view.kind === "blob") {
      list.push({ id: "next-file", label: t("Next file"), hint: "]", run: () => step(1) });
      list.push({ id: "previous-file", label: t("Previous file"), hint: "[", run: () => step(-1) });
      list.push({ id: "up", label: t("Back to the list"), hint: "Esc", run: upToList });
    }
    if (storyId) {
      list.push({ id: "find-file", label: t("Go to file…"), hint: "t", run: findFile });
      for (const tab of REPO_TABS) {
        if (tab.inert) continue;
        const id = tab.id as RepoTab;
        list.push({ id: `tab-${id}`, label: tab.label, hint: TAB_KEYS[id], run: () => openRepo(storyId, id) });
      }
    }
    if (view.kind !== "home") list.push({ id: "repositories", label: "Repositories", hint: "g d", run: goHome });
    return list;
  }, [view.kind, storyId, step, upToList, findFile, openRepo, goHome, t]);
  const allCommands = useMemo(() => [...own, ...commands], [own, commands]);

  // ---- Keys ---------------------------------------------------------------------------

  const actions = useRef<Record<KeyAction, () => void>>({} as Record<KeyAction, () => void>);
  const goTab = (tab: RepoTab) => () => {
    if (storyId) openRepo(storyId, tab);
  };
  actions.current = {
    palette: () => setPaletteOpen(true),
    next: () => step(1),
    previous: () => step(-1),
    up: upToList,
    "find-file": findFile,
    "go-home": goHome,
    "go-code": goTab("code"),
    "go-issues": goTab("issues"),
    "go-pulls": goTab("pulls"),
    "go-actions": goTab("actions"),
    "go-settings": goTab("settings"),
  };
  // A pull request or an issue answers to the repository's keys.
  const place = view.kind === "pull" || view.kind === "issue" ? "repo" : view.kind;
  const keyState = useRef({ place, overlay: overlayOpen, pendingG: false, timer: 0 });
  keyState.current.place = place;
  keyState.current.overlay = overlayOpen;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = keyState.current;
      if (event.defaultPrevented || state.overlay || document.querySelector("[data-stealth-decoy]")) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Outside the skin (the settings dialog) or typing in a field: not ours.
      if (target && target !== document.body && !scroller.current?.contains(target)) return;
      if (target && isTyping(target)) return;
      const { action, pendingG } = keyAction(event, { place: state.place, pendingG: state.pendingG });
      window.clearTimeout(state.timer);
      state.pendingG = pendingG;
      if (pendingG) state.timer = window.setTimeout(() => (state.pendingG = false), CHORD_MS);
      if (!action) return;
      event.preventDefault();
      actions.current[action]();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(keyState.current.timer);
    };
  }, []);

  // ---- Menus: every way out of the skin, without a shortcut -------------------------

  const openHereInDefault = useCallback(
    () => openInDefault(storyId ? { storyId, order: order ?? undefined } : undefined),
    [openInDefault, storyId, order]
  );
  const appEntries = useAppMenuEntries({ openInDefault: openHereInDefault, openSettings });
  const accountEntries = useMemo<MenuEntry[]>(
    () => [
      { kind: "heading", id: "account", label: "dev" },
      { kind: "item", id: "your-repositories", label: "Your repositories", run: goHome },
      { kind: "separator", id: "account-sep" },
      ...appEntries,
    ],
    [appEntries, goHome]
  );
  const navEntries = useMemo<MenuEntry[]>(
    () => [
      { kind: "item", id: "nav-home", label: "Repositories", run: goHome },
      ...(entries.length > 0
        ? ([
            { kind: "separator", id: "nav-sep" },
            { kind: "heading", id: "nav-heading", label: "Top repositories" },
          ] as MenuEntry[])
        : []),
      ...entries.slice(0, 8).map(
        (candidate): MenuEntry => ({
          kind: "item",
          id: `nav-${candidate.story.id}`,
          label: `${ORG}/${candidate.name}`,
          run: () => openRepo(candidate.story.id),
        })
      ),
    ],
    [entries, goHome, openRepo]
  );

  // ---- Page ---------------------------------------------------------------------------

  const run = storyId ? currentRun(crawl, job) : null;
  const fileForUrl = useCallback(
    (url: string) => {
      const match = chapters?.find((candidate) => candidate.url === url);
      return match ? chapterFileName(match.order, match.title, neutral) : null;
    },
    [chapters, neutral]
  );
  const log = useMemo(() => (view.kind === "repo" && view.tab === "actions" ? logRows(job.log, fileForUrl) : []), [view, job.log, fileForUrl]);
  const updatedAt = storyData.story?.updatedAt ?? entry?.story.updatedAt ?? null;
  const doneCount = files ? files.filter((candidate) => candidate.status === "done").length : (entry?.story.doneCount ?? 0);
  const lastOrder = files && files.length > 0 ? files[files.length - 1].order : 0;

  const storyFailed = !chapters && storyData.error;
  let page;
  if (view.kind === "home") {
    page = (
      <RepoList
        entries={entries}
        loading={listLoading}
        error={listError}
        onRetry={() => void reloadList()}
        live={live}
        query={repoQuery}
        onQuery={(query) => {
          setRepoQuery(query);
          setHomePage(0);
        }}
        page={homePage}
        onPage={(to) => {
          setHomePage(to);
          if (scroller.current) scroller.current.scrollTop = 0;
        }}
        onOpen={(id) => openRepo(id)}
        filterRef={repoFilter}
        now={now}
      />
    );
  } else if (view.kind === "blob" && storyFailed) {
    page = (
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 md:px-6">
        <Flash tone="danger">
          <p>{stripUrls(storyData.error!)}</p>
          <button type="button" className={`${BTN_SM} mt-3`} onClick={() => void storyData.reload()}>
            {t("Retry")}
          </button>
        </Flash>
      </main>
    );
  } else if (view.kind === "blob" && file) {
    page = (
      <BlobView
        storyId={view.storyId}
        repo={repo ?? ""}
        file={file}
        status={status}
        failure={chapter?.error ?? null}
        missing={!!chapters && !chapter}
        text={text}
        error={chapterText.error}
        mode={mode}
        onMode={changeMode}
        previous={previous}
        next={next}
        onStep={step}
        onRepo={upToList}
        onDownload={download}
        scroller={scroller}
        startLine={startLine.current}
        onTopLine={onTopLine}
        committedAt={updatedAt ? fileTime(updatedAt, view.order, lastOrder) : null}
        now={now}
        sidebar={
          treeOpen && treeEntries.length > 0 ? (
            <FileTreePanel files={treeEntries} current={view.order} onOpen={(fileOrder) => openFile(view.storyId, fileOrder, 0)} onClose={() => changeTree(false)} />
          ) : null
        }
        onShowTree={() => changeTree(true)}
      />
    );
  } else if (view.kind === "pull") {
    const key = storeKey(view.number);
    if (!openPullData) {
      page = (
        <main className="mx-auto w-full max-w-[1280px] px-4 py-6 md:px-6">
          <Blankslate icon={<GitPullRequest size={24} />} title="This pull request no longer exists." />
        </main>
      );
    } else if (view.number === DOCS_PULL && !docs?.ready) {
      page = docsText.error ? (
        <main className="mx-auto w-full max-w-[1280px] px-4 py-6 md:px-6">
          <Flash tone="danger">{`${t("Could not open this file")}: ${stripUrls(docsText.error)}`}</Flash>
        </main>
      ) : (
        <Spinner label={t("Loading…")} />
      );
    } else {
      page = (
        <PullRequestPage
          key={key}
          pr={openPullData}
          now={now}
          saved={prStore.current.get(key)}
          onSave={(state) => {
            prStore.current.set(key, state);
            storeChanged();
          }}
          development={
            <LinkedItems
              intro={openPullData.closes.length > 0 ? "Successfully merging this pull request may close these issues." : "No linked issues"}
              items={openPullData.closes.map((number) => ({ kind: "issue" as const, number, title: fake.issues.find((issue) => issue.number === number)?.title ?? "" }))}
              onOpen={openItem}
            />
          }
        />
      );
    }
  } else if (view.kind === "issue") {
    const key = storeKey(view.number);
    page = openIssueData ? (
      <IssuePage
        key={key}
        issue={openIssueData}
        now={now}
        saved={issueStore.current.get(key)}
        onSave={(state) => {
          issueStore.current.set(key, state);
          storeChanged();
        }}
        development={
          <LinkedItems
            intro={fake.pulls.some((pull) => pull.closes.includes(view.number)) ? "Pull requests that will close this issue" : "No branches or pull requests"}
            items={fake.pulls.filter((pull) => pull.closes.includes(view.number)).map((pull) => ({ kind: "pr" as const, number: pull.number, title: pull.title }))}
            onOpen={openItem}
          />
        }
      />
    ) : (
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 md:px-6">
        <Blankslate icon={<CircleDot size={24} />} title="This issue no longer exists." />
      </main>
    );
  } else if (view.kind === "repo") {
    let tab;
    if (view.tab === "code")
      tab = (
        <CodeTab
          storyId={view.storyId}
          repo={repo ?? ""}
          description={description}
          updatedAt={updatedAt}
          files={files}
          loading={storyData.loading}
          error={storyData.error}
          onRetry={() => void storyData.reload()}
          crawl={crawl}
          page={filePage ?? 0}
          onPage={(to) => {
            setFilePages((pages) => ({ ...pages, [view.storyId]: to }));
            if (scroller.current) scroller.current.scrollTop = 0;
          }}
          query={fileQuery}
          onQuery={(query) => {
            setFileQuery(query);
            setFilePages((pages) => ({ ...pages, [view.storyId]: 0 }));
          }}
          filterRef={fileFilter}
          onOpenFile={(fileOrder) => openFile(view.storyId, fileOrder)}
          lastRead={lastRead}
          onActions={() => openRepo(view.storyId, "actions")}
          onDownload={download}
          now={now}
        />
      );
    else if (view.tab === "actions")
      tab = (
        <ActionsTab
          run={run}
          number={runNumber(view.storyId)}
          log={log}
          lastRunAt={doneCount > 0 ? updatedAt : null}
          onRun={download}
          onCancel={stopDownload}
          now={now}
        />
      );
    else if (view.tab === "issues")
      tab = <ItemList kind="issue" rows={issueRows} query={issueQuery} onQuery={setIssueQuery} onOpen={(number) => openItem("issue", number)} now={now} />;
    else if (view.tab === "pulls")
      tab = <ItemList kind="pr" rows={pullRows} query={pullQuery} onQuery={setPullQuery} onOpen={(number) => openItem("pr", number)} now={now} />;
    else tab = <SettingsTab repo={repo ?? ""} />;
    page = (
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 md:px-6">
        {view.tab === "code" && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <Avatar seed={ORG} size={24} square />
            <strong className="min-w-0 break-all text-[20px] font-semibold">{repo}</strong>
            <Label>Private</Label>
            <span className="ml-auto hidden gap-2 md:flex" aria-hidden="true">
              <span className={BTN_SM}>Pin</span>
              <span className={BTN_SM}>
                Watch <span className="rounded-full bg-repo-counter px-1.5">1</span>
              </span>
              <span className={BTN_SM}>
                Fork <span className="rounded-full bg-repo-counter px-1.5">0</span>
              </span>
              <span className={BTN_SM}>
                Star <span className="rounded-full bg-repo-counter px-1.5">0</span>
              </span>
            </span>
          </div>
        )}
        {tab}
      </main>
    );
  }

  const orgTabs: NavTab<string>[] = [
    { id: "overview", label: "Overview", icon: <Table2 size={16} />, inert: true },
    { id: "repositories", label: "Repositories", icon: <BookMarked size={16} />, counter: entries.length },
    { id: "packages", label: "Packages", icon: <Package size={16} />, inert: true },
    { id: "people", label: "People", icon: <Users size={16} />, inert: true },
  ];

  return (
    <div ref={scroller} tabIndex={-1} className="h-full overflow-y-auto bg-repo-canvas font-repo text-repo-fg outline-none">
      <GlobalHeader
        org={ORG}
        repo={repo}
        actions={{
          onMenu: (element) => menu.open("nav", element),
          onHome: goHome,
          onRepo: storyId ? () => openRepo(storyId) : undefined,
          onSearch: () => setPaletteOpen(true),
          onAccount: (element) => menu.open("account", element),
          labels: {
            menu: t("Navigation menu"),
            search: t("Show and run commands"),
            account: t("Account menu"),
            home: "Repositories",
          },
        }}
      >
        {storyId ? (
          <UnderlineNav<RepoNavId>
            label="Repository"
            tabs={REPO_TABS.map((tab) =>
              tab.id === "issues" ? { ...tab, counter: openIssueCount } : tab.id === "pulls" ? { ...tab, counter: openPullCount } : tab
            )}
            current={view.kind === "repo" ? view.tab : view.kind === "pull" ? "pulls" : view.kind === "issue" ? "issues" : "code"}
            onSelect={(id) => openRepo(storyId, id as RepoTab)}
          />
        ) : (
          <UnderlineNav<string> label="Organization" tabs={orgTabs} current="repositories" onSelect={() => setHomePage(0)} />
        )}
      </GlobalHeader>

      {crawlError && (
        <div className="mx-auto w-full max-w-[1280px] px-4 pt-4 md:px-6">
          <Flash tone="danger" onDismiss={clearCrawlError} dismissLabel={t("Dismiss")}>
            {t("Download failed: {message}", { message: stripUrls(crawlError) })}
          </Flash>
        </div>
      )}

      {page}

      <footer className="mx-auto mt-10 flex w-full max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-2 px-4 pb-10 pt-6 text-[12px] text-repo-muted md:px-6" aria-hidden="true">
        <Hexagon size={22} strokeWidth={1.75} />
        <span>© {new Date(now).getFullYear()} {ORG}</span>
        {["Terms", "Privacy", "Security", "Status", "Docs", "Contact"].map((name) => (
          <span key={name}>{name}</span>
        ))}
      </footer>

      {notice && <Toast>{notice}</Toast>}

      <AppMenu
        anchor={menu.menu?.anchor ?? null}
        entries={menu.menu?.id === "nav" ? navEntries : accountEntries}
        onClose={menu.close}
        tone="repo"
        label={menu.menu?.id === "nav" ? t("Navigation menu") : t("Account menu")}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={allCommands} placeholder={t("Type a command")} tone="repo" />
    </div>
  );
}
