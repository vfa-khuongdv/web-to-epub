import { ArrowDown, ArrowUp, Check, CheckCheck, MessagesSquare, RefreshCw } from "lucide-react";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChapterText, useChapterLines } from "../../hooks/useChapterLines";
import { useStoryChapters } from "../../hooks/useStoryChapters";
import { useStoryList } from "../../hooks/useStoryList";
import { useLang } from "../../i18n";
import { readSkinPosition, writeSkinPosition } from "../../lib/skins/position";
import { requestStealthToggle } from "../../lib/ui/stealth";
import { StoredChapter } from "../../types";
import { AppMenu, MenuEntry } from "../AppMenu";
import { CommandPalette, PaletteCommand } from "../CommandPalette";
import { stripUrls } from "../../lib/skins/crawlLog";
import { CHAT_ICON } from "../registry";
import { adjacentChapter, shownStatus, sortChapters } from "../../lib/skins/chapters";
import { useCrawlVersions } from "../../hooks/useCrawlVersions";
import { SkinAppContext } from "../types";
import { useAppMenuEntries, useMenuState } from "../useAppMenu";
import { useSkinCommands } from "../useSkinCommands";
import { Rail, RailEntry, TopBar } from "./ChatChrome";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { ConversationHeader } from "./ConversationHeader";
import { YOU, buildConversation, threadDate, threadLines } from "./threadModel";
import { CONTACTS } from "./fakeData";
import { HomeRow, HomeView } from "./HomeView";
import { chatKeyAction } from "./keys";
import { BotMessage, DayDivider, HeadingDivider, MessageGroup, SkeletonMessages, SystemNote } from "./Messages";
import { SlashCommand } from "./slash";
import {
  HOME_PAGE,
  RAIL_STEP,
  THREAD_PAGE,
  clockText,
  listTime,
  memberCount,
  pageBounds,
  pageCount,
  pageOfIndex,
  spaceInitials,
  spaceName,
  threadLabel,
  toneFor,
  unreadEstimate,
  unreadExact,
} from "./spaces";
import { ThreadEntry, ThreadsPanel } from "./ThreadsPanel";

type View = { kind: "home" } | { kind: "space"; storyId: string; order: number | null } | { kind: "dm"; id: string };

interface EchoMessage {
  id: number;
  text: string;
  time: string;
}

const NOTICE_MS = 4000;
// The rail shows as a column from this width; under it, it slides over the page.
const WIDE = 768;

function nowClock(): string {
  const now = new Date();
  return clockText(now.getHours() * 60 + now.getMinutes());
}

// A key typed into a text field belongs to the text (the composer is marked data-boss-key
// for the boss key's sake, but "[" there is still a character).
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

const BUTTON =
  "inline-flex h-10 items-center gap-2 rounded-full px-5 text-[14px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-chat-accent focus-visible:ring-offset-2 focus-visible:ring-offset-chat-surface";
const PRIMARY = `${BUTTON} bg-chat-accent text-chat-accent-fg hover:shadow-[0_1px_3px_rgba(0,0,0,0.25)]`;
const SECONDARY = `${BUTTON} border border-chat-rule text-chat-accent hover:bg-chat-accent-soft`;
const TEXT_LINK =
  "rounded-full px-2 py-1 font-medium text-chat-accent outline-none hover:bg-chat-accent-soft focus-visible:ring-2 focus-visible:ring-chat-accent";

/**
 * The team-chat skin: the library as the spaces in the rail and on Home, a story as a
 * space whose threads are its chapters, and a chapter as one thread — every paragraph a
 * message from a made-up colleague. Direct messages are decoration with a few lines of
 * office talk. Everything the skin does not draw is in the search box's command list
 * (F1, Ctrl/Cmd+K), the account menu, or a slash command in the composer.
 */
export default function ChatShell({ app }: { app: SkinAppContext }) {
  const { t } = useLang();
  const { attach, setHead, isPrivate, neutralNames: neutral, live, job } = app;
  const [view, setView] = useState<View>({ kind: "home" });
  const [today] = useState(() => new Date());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(() => window.innerWidth >= WIDE);
  const [railShown, setRailShown] = useState(RAIL_STEP);
  const [homePage, setHomePage] = useState(0);
  const [threadPage, setThreadPage] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [echo, setEcho] = useState<Record<string, EchoMessage[]>>({});
  // Bumped when a thread is opened, so the unread badges re-read the saved positions.
  const [positionTick, setPositionTick] = useState(0);
  // Each opening of a thread scrolls to its start line once, even the one already open.
  const [openToken, setOpenToken] = useState(0);
  const startLine = useRef(0);
  const echoId = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement>(null);
  const composer = useRef<HTMLInputElement>(null);

  const storyId = view.kind === "space" ? view.storyId : null;
  const order = view.kind === "space" ? view.order : null;
  const narrow = () => window.innerWidth < WIDE;

  const versions = useCrawlVersions(live);
  const { stories, loading: listLoading, error: listError, reload } = useStoryList(live);
  const storyData = useStoryChapters(storyId, live);
  const chapters = useMemo(() => (storyData.story ? sortChapters(storyData.story.chapters) : null), [storyData.story]);
  const crawl = storyId ? live[storyId] : undefined;
  const liveStates = storyId && crawl ? job.chapters : undefined;
  const chapterText = useChapterLines(order !== null ? storyId : null, order, storyId ? (versions[storyId] ?? 0) : 0);

  // A thread re-read after its download ended keeps the old text on screen until the new
  // one is in, so the reader is not thrown back to the top.
  const lastText = useRef<{ key: string; text: ChapterText } | null>(null);
  const textKey = storyId && order !== null ? `${storyId}:${order}` : null;
  if (chapterText.text && textKey) lastText.current = { key: textKey, text: chapterText.text };
  const textValue =
    chapterText.text ??
    (!chapterText.error && textKey && lastText.current?.key === textKey ? lastText.current.text : null);

  const names = useMemo(
    () => new Map(stories.map((story, index) => [story.id, spaceName(story.title, index, neutral, t)])),
    [stories, neutral, t]
  );
  const openName = storyId ? (names.get(storyId) ?? "") : "";
  const contact = view.kind === "dm" ? (CONTACTS.find((entry) => entry.id === view.id) ?? null) : null;

  const statusOf = useCallback((chapter: StoredChapter) => shownStatus(chapter, liveStates), [liveStates]);
  const readableOrders = useMemo(
    () => (chapters ? chapters.filter((chapter) => statusOf(chapter) === "done").map((chapter) => chapter.order) : null),
    [chapters, statusOf]
  );
  const currentChapter = chapters && order !== null ? (chapters.find((chapter) => chapter.order === order) ?? null) : null;

  // ---- Opening things ---------------------------------------------------------------

  const openSpace = useCallback(
    (id: string) => {
      const saved = readSkinPosition(id, isPrivate);
      startLine.current = saved?.line ?? 0;
      setOpenToken((value) => value + 1);
      setView({ kind: "space", storyId: id, order: saved?.order ?? null });
      if (narrow()) setRailOpen(false);
    },
    [isPrivate]
  );

  const openThread = useCallback(
    (id: string, chapterOrder: number, line = 0) => {
      startLine.current = line;
      setOpenToken((value) => value + 1);
      setView({ kind: "space", storyId: id, order: chapterOrder });
      writeSkinPosition(id, isPrivate, { order: chapterOrder, line });
      setPositionTick((value) => value + 1);
      if (narrow()) setThreadsOpen(false);
    },
    [isPrivate]
  );

  const openDm = useCallback((id: string) => {
    setView({ kind: "dm", id });
    if (narrow()) setRailOpen(false);
  }, []);

  const goHome = useCallback(() => setView({ kind: "home" }), []);

  // A space opened for the first time starts at its first thread that has messages.
  useEffect(() => {
    if (view.kind !== "space" || view.order !== null || !chapters) return;
    const first = chapters.find((chapter) => statusOf(chapter) === "done");
    if (first) openThread(view.storyId, first.order, 0);
  }, [view, chapters, statusOf, openThread]);

  const stepThread = useCallback(
    (direction: 1 | -1) => {
      if (view.kind !== "space" || view.order === null || !chapters) return;
      const to = adjacentChapter(chapters, view.order, direction, liveStates);
      if (to === null) {
        setNotice(direction === 1 ? t("Nothing later.") : t("Nothing earlier."));
        return;
      }
      openThread(view.storyId, to, 0);
    },
    [view, chapters, liveStates, openThread, t]
  );

  const toggleThreads = useCallback(() => setThreadsOpen((open) => !open), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);

  const onTopLine = useCallback(
    (line: number) => {
      if (!storyId || order === null) return;
      writeSkinPosition(storyId, isPrivate, { order, line });
    },
    [storyId, order, isPrivate]
  );

  // ---- Live downloads, tab head, notices --------------------------------------------

  useEffect(() => (storyId ? attach("space", storyId) : undefined), [attach, storyId]);

  const headTitle = view.kind === "space" && openName ? `Chat – ${openName}` : contact ? `Chat – ${contact.name}` : "Chat";
  useEffect(() => {
    setHead({ title: headTitle, favicon: CHAT_ICON });
  }, [setHead, headTitle]);
  useEffect(() => () => setHead(null), [setHead]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // The threads panel opens on the page holding the open thread.
  useEffect(() => {
    if (!threadsOpen || !chapters || order === null) return;
    setThreadPage(pageOfIndex(chapters.findIndex((chapter) => chapter.order === order), THREAD_PAGE));
  }, [threadsOpen, chapters, order]);

  // ---- Commands ---------------------------------------------------------------------

  const { commands, crawlError, clearCrawlError } = useSkinCommands(app, { storyId, order });
  const crawlCommand = commands.find((command) => command.id === "crawl");
  const stopCommand = commands.find((command) => command.id === "stop-crawl");
  const openHereInDefault = useCallback(
    () => app.openInDefault(storyId ? { storyId, order: order ?? undefined } : undefined),
    [app, storyId, order]
  );

  const allCommands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [];
    if (view.kind === "space") {
      list.push({ id: "next-thread", label: t("Next thread"), hint: "Alt+↓", run: () => stepThread(1) });
      list.push({ id: "previous-thread", label: t("Previous thread"), hint: "Alt+↑", run: () => stepThread(-1) });
      list.push({ id: "threads", label: t("Show or hide the thread list"), run: toggleThreads });
    }
    if (view.kind !== "home") list.push({ id: "home", label: t("Back to the list"), run: goHome });
    list.push(...commands);
    // The search box finds spaces by name, as the chat's own search does.
    stories.slice(0, 300).forEach((story) => {
      list.push({ id: `space-${story.id}`, label: names.get(story.id) ?? "", hint: "Space", run: () => openSpace(story.id) });
    });
    return list;
  }, [view.kind, commands, stories, names, stepThread, toggleThreads, goHome, openSpace, t]);

  const slashCommands = useMemo<SlashCommand[]>(() => {
    const list: SlashCommand[] = [];
    if (view.kind === "space") {
      list.push({ name: "next", description: t("Next thread"), run: () => stepThread(1) });
      list.push({ name: "prev", description: t("Previous thread"), run: () => stepThread(-1) });
      list.push({ name: "threads", description: t("Show or hide the thread list"), run: toggleThreads });
      if (crawlCommand) list.push({ name: "download", description: crawlCommand.label, run: crawlCommand.run });
      if (stopCommand) list.push({ name: "stop", description: stopCommand.label, run: stopCommand.run });
    }
    list.push({ name: "find", description: t("Show and run commands"), run: openPalette });
    list.push({ name: "home", description: t("Back to the list"), run: goHome });
    list.push({ name: "normal", description: t("Open in the normal view"), run: openHereInDefault });
    list.push({ name: "hide", description: t("Hide now"), run: requestStealthToggle });
    return list;
  }, [view.kind, crawlCommand, stopCommand, stepThread, toggleThreads, openPalette, goHome, openHereInDefault, t]);

  const echoKey = view.kind === "space" ? `space:${storyId}:${order}` : view.kind === "dm" ? `dm:${view.id}` : "";
  const addEcho = useCallback(
    (text: string) => {
      if (!echoKey) return;
      const message = { id: ++echoId.current, text, time: nowClock() };
      setEcho((current) => ({ ...current, [echoKey]: [...(current[echoKey] ?? []), message] }));
    },
    [echoKey]
  );

  // ---- Menus ------------------------------------------------------------------------

  const menus = useMenuState<"account" | "space">();
  const accountMenu = useAppMenuEntries({ openInDefault: openHereInDefault, openSettings: app.openSettings });
  const spaceMenu = useMemo<MenuEntry[]>(() => {
    const list: MenuEntry[] = [{ kind: "item", id: "threads", label: t("Show or hide the thread list"), run: toggleThreads }];
    if (crawlCommand) list.push({ kind: "item", id: "crawl", label: crawlCommand.label, run: crawlCommand.run });
    if (stopCommand) list.push({ kind: "item", id: "stop-crawl", label: stopCommand.label, run: stopCommand.run });
    list.push({ kind: "separator", id: "space-sep" });
    list.push({ kind: "item", id: "home", label: t("Back to the list"), run: goHome });
    list.push({ kind: "item", id: "open-default", label: t("Open in the normal view"), run: openHereInDefault });
    list.push({ kind: "item", id: "hide", label: t("Hide now"), hint: "`", run: requestStealthToggle });
    return list;
  }, [crawlCommand, stopCommand, toggleThreads, goHome, openHereInDefault, t]);

  // ---- Keys and focus ---------------------------------------------------------------

  const latest = useRef({ openPalette, stepThread, paletteOpen, threadsOpen, menuOpen: !!menus.menu });
  latest.current = { openPalette, stepThread, paletteOpen, threadsOpen, menuOpen: !!menus.menu };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = latest.current;
      if (event.defaultPrevented || state.paletteOpen || state.menuOpen) return;
      if (document.querySelector("[data-stealth-decoy]")) return;
      const target = event.target instanceof Node ? event.target : null;
      const inside = !target || target === document.body || !!root.current?.contains(target);
      if (!inside) return;
      const typing = isTyping(event.target);
      if (event.key === "Escape" && state.threadsOpen && !typing && window.innerWidth < 1024) {
        event.preventDefault();
        setThreadsOpen(false);
        return;
      }
      const action = chatKeyAction(event, typing);
      if (!action) return;
      event.preventDefault();
      if (action === "palette") state.openPalette();
      else state.stepThread(action === "next" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The messages take the keys (Space, Page Down) when a thread opens or the palette
  // closes — not while the composer is in use, nor when something outside the skin (the
  // settings) has focus.
  const focusKey = `${view.kind}:${storyId ?? ""}:${order ?? ""}:${contact?.id ?? ""}:${openToken}`;
  useEffect(() => {
    if (paletteOpen) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && !root.current?.contains(active)) return;
      if (active && active === composer.current) return;
      scroller.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey, paletteOpen]);

  // ---- Rail and home ----------------------------------------------------------------

  const unread = useMemo(() => {
    void positionTick;
    const counts = new Map<string, number>();
    for (const story of stories) {
      const saved = readSkinPosition(story.id, isPrivate)?.order ?? null;
      counts.set(
        story.id,
        story.id === storyId && readableOrders ? unreadExact(readableOrders, saved) : unreadEstimate(story.doneCount, saved)
      );
    }
    return counts;
  }, [stories, isPrivate, positionTick, storyId, readableOrders]);

  const railSpaces: RailEntry[] = stories.slice(0, railShown).map((story) => {
    const name = names.get(story.id) ?? "";
    const count = unread.get(story.id) ?? 0;
    return {
      key: story.id,
      name,
      tone: toneFor(story.id),
      initials: spaceInitials(name),
      active: storyId === story.id,
      unread: count,
      busy: !!live[story.id],
      detail: count > 0 ? `${count} unread` : undefined,
      onClick: () => openSpace(story.id),
    };
  });
  const railContacts: RailEntry[] = CONTACTS.map((entry) => ({
    key: entry.id,
    name: entry.name,
    tone: entry.tone,
    presence: entry.presence,
    active: contact?.id === entry.id,
    onClick: () => openDm(entry.id),
  }));
  let railFooter: ReactNode = null;
  if (listError)
    railFooter = (
      <button type="button" className={`${TEXT_LINK} -ml-2 text-chat-error`} onClick={() => void reload()}>
        {t("Retry")}
      </button>
    );
  else if (listLoading && stories.length === 0) railFooter = <span className="text-chat-faint">{t("Loading…")}</span>;
  else if (stories.length > railShown)
    railFooter = (
      <button type="button" className={`${TEXT_LINK} -ml-2`} onClick={() => setRailShown((count) => count + RAIL_STEP)}>
        {t("Load more…")}
      </button>
    );

  const homeBounds = pageBounds(homePage, HOME_PAGE, stories.length);
  const homeRows: HomeRow[] = stories.slice(homeBounds.start, homeBounds.end).map((story) => {
    const name = names.get(story.id) ?? "";
    const count = unread.get(story.id) ?? 0;
    const running = live[story.id];
    const snippet = running
      ? t("Downloading {done}/{total}", { done: running.cursor, total: running.total })
      : count > 0
        ? `${count} unread · ${story.chapterCount} threads`
        : t("You're all caught up");
    return {
      key: story.id,
      name,
      initials: spaceInitials(name),
      tone: toneFor(story.id),
      snippet,
      time: listTime(story.updatedAt, today),
      unread: count,
      busy: !!running,
      onOpen: () => openSpace(story.id),
    };
  });
  const homePages = pageCount(stories.length, HOME_PAGE);
  const homePaging =
    homePages > 1
      ? {
          text: t("{from}–{to} of {total}", { from: homeBounds.start + 1, to: homeBounds.end, total: stories.length }),
          onPrevious: homePage > 0 ? () => setHomePage((page) => page - 1) : undefined,
          onNext: homePage < homePages - 1 ? () => setHomePage((page) => page + 1) : undefined,
        }
      : null;

  // ---- The open space ---------------------------------------------------------------

  const labelOf = useMemo(() => {
    const map = new Map<number, string>();
    for (const chapter of chapters ?? []) map.set(chapter.order, threadLabel(chapter.order, chapter.title, neutral, t));
    return map;
  }, [chapters, neutral, t]);
  const currentLabel = order !== null ? (labelOf.get(order) ?? threadLabel(order, "", true, t)) : "";
  const pendingCount = chapters ? chapters.filter((chapter) => statusOf(chapter) === "pending").length : 0;
  const nextOrder = chapters && order !== null ? adjacentChapter(chapters, order, 1, liveStates) : null;
  const previousOrder = chapters && order !== null ? adjacentChapter(chapters, order, -1, liveStates) : null;
  const savedOrder = useMemo(() => {
    void positionTick;
    return storyId ? (readSkinPosition(storyId, isPrivate)?.order ?? null) : null;
  }, [storyId, isPrivate, positionTick]);

  const items = useMemo(() => {
    if (!textValue || order === null || !storyId || !chapters) return null;
    const lastOrder = chapters.length > 0 ? chapters[chapters.length - 1].order : order;
    // Never the chapter's own title or a "Chương N" heading, neutral names or not.
    const lines = threadLines(textValue.lines, { title: textValue.title, titleDropped: neutral });
    return buildConversation(lines, {
      spaceKey: storyId,
      order,
      date: threadDate(today, Math.max(0, lastOrder - order)),
      today,
    });
  }, [textValue, order, storyId, chapters, today, neutral]);

  const threadEntries: ThreadEntry[] = useMemo(() => {
    if (!chapters || !storyId) return [];
    const bounds = pageBounds(threadPage, THREAD_PAGE, chapters.length);
    return chapters.slice(bounds.start, bounds.end).map((chapter) => {
      const status = statusOf(chapter);
      return {
        key: String(chapter.order),
        label: labelOf.get(chapter.order) ?? "",
        status,
        current: chapter.order === order,
        read: savedOrder !== null && chapter.order <= savedOrder,
        onOpen: () => {
          if (status === "done") openThread(storyId, chapter.order, 0);
          else setNotice(status === "error" ? t("Download failed") : t("Not downloaded yet."));
        },
      };
    });
  }, [chapters, storyId, threadPage, statusOf, labelOf, order, savedOrder, openThread, t]);

  const threadPages = chapters ? pageCount(chapters.length, THREAD_PAGE) : 1;
  const threadBounds = pageBounds(threadPage, THREAD_PAGE, chapters?.length ?? 0);
  const threadPaging =
    chapters && threadPages > 1
      ? {
          text: t("{from}–{to} of {total}", {
            from: threadBounds.start + 1,
            to: threadBounds.end,
            total: chapters.length,
          }),
          onPrevious: threadPage > 0 ? () => setThreadPage((page) => page - 1) : undefined,
          onNext: threadPage < threadPages - 1 ? () => setThreadPage((page) => page + 1) : undefined,
        }
      : null;

  // The running download, as the sync helper's message (never an address: the thread it
  // is on is named from the list, and a failure's text has its addresses stripped).
  const runningLabel = useMemo(() => {
    if (!crawl || !chapters) return null;
    const url = Object.keys(job.chapters).find((key) => job.chapters[key] === "running");
    const chapter = url ? chapters.find((entry) => entry.url === url) : undefined;
    return chapter ? (labelOf.get(chapter.order) ?? null) : null;
  }, [crawl, chapters, job.chapters, labelOf]);
  const lastLog = job.log.length > 0 ? job.log[job.log.length - 1] : null;
  const lastError = crawl && lastLog?.isError ? stripUrls(lastLog.text.replace(/^\[\d+\/\d+\]\s+\S+\s+—\s+/, "")) : null;

  const downloadButton = crawlCommand && pendingCount > 0 && (
    <button type="button" className={SECONDARY} onClick={crawlCommand.run}>
      {crawlCommand.label}
    </button>
  );

  const crawlStatus = crawl ? (
    <>
      <RefreshCw size={12} className="flex-none animate-[spin_2.4s_linear_infinite] text-chat-online" aria-hidden="true" />
      <span className="truncate">
        {t("Downloading {done}/{total}", { done: crawl.cursor, total: crawl.total })}
        {crawl.errors > 0 && ` · ${t("Download errors: {count}", { count: crawl.errors })}`}
      </span>
    </>
  ) : null;

  const echoes = echo[echoKey] ?? [];
  const echoGroup = echoes.length > 0 && (
    <MessageGroup
      name={YOU.name}
      tone={YOU.tone}
      time={echoes[0].time}
      messages={echoes.map((message) => ({ key: `e${message.id}`, kind: "text", text: message.text }))}
    />
  );

  let spaceBody: ReactNode = null;
  if (view.kind === "space") {
    const listFailed = storyData.error && !chapters;
    const noThreads = chapters && order === null;
    const status = currentChapter ? statusOf(currentChapter) : null;
    spaceBody = (
      <>
        {listFailed ? (
          <SystemNote tone="error">
            {t("Could not load these messages.")} {stripUrls(storyData.error ?? "")}
          </SystemNote>
        ) : noThreads ? (
          <div className="mx-auto mt-[10vh] flex max-w-[440px] flex-col items-center text-center">
            <span className="grid size-20 place-items-center rounded-full bg-chat-accent-soft text-chat-accent" aria-hidden="true">
              <MessagesSquare size={36} strokeWidth={1.4} />
            </span>
            <p className="mt-5 text-[15px] text-chat-fg">{t("Nothing here has been downloaded yet.")}</p>
            {pendingCount > 0 && (
              <p className="mt-1 text-[13px] text-chat-dim">{t("{count} not downloaded yet", { count: pendingCount })}</p>
            )}
            <div className="mt-4">{downloadButton}</div>
          </div>
        ) : status && status !== "done" && !items?.some((item) => item.kind !== "day") ? (
          <SystemNote tone={status === "error" ? "error" : "dim"}>
            {status === "error"
              ? `${t("Download failed")}${currentChapter?.error ? `: ${stripUrls(currentChapter.error)}` : ""}`
              : t("Not downloaded yet.")}
          </SystemNote>
        ) : chapterText.error && !items ? (
          <SystemNote tone="error">
            {t("Could not load these messages.")} {stripUrls(chapterText.error)}
          </SystemNote>
        ) : !items ? (
          <SkeletonMessages label={t("Loading…")} />
        ) : (
          items.map((item) =>
            item.kind === "day" ? (
              <DayDivider key={item.key} label={item.label} />
            ) : item.kind === "heading" ? (
              <HeadingDivider key={item.key} text={item.text} line={item.line} />
            ) : (
              <MessageGroup
                key={item.key}
                name={item.member.name}
                tone={item.member.tone}
                time={item.time}
                messages={item.messages.map((message) => ({
                  key: String(message.line),
                  line: message.line,
                  kind: message.kind,
                  text: message.text,
                }))}
              />
            )
          )
        )}
        {echoGroup}
        {crawl && (
          <BotMessage name="Sync" time={nowClock()} note="Only visible to you">
            <p className="font-medium">
              {t("Downloading {done}/{total}", { done: crawl.cursor, total: crawl.total })}
              {crawl.errors > 0 && (
                <span className="text-chat-error"> · {t("Download errors: {count}", { count: crawl.errors })}</span>
              )}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-chat-rule">
              <div
                className="h-full rounded-full bg-chat-online transition-[width] duration-500"
                style={{ width: `${crawl.total > 0 ? Math.round((crawl.cursor / crawl.total) * 100) : 0}%` }}
              />
            </div>
            {runningLabel && <p className="mt-2 truncate text-[13px] text-chat-dim">→ {runningLabel}</p>}
            {lastError && <p className="mt-1 break-words text-[13px] text-chat-error">{lastError}</p>}
            {stopCommand && (
              <button type="button" className={`${TEXT_LINK} -ml-2 mt-2 text-[13px]`} onClick={stopCommand.run}>
                {stopCommand.label}
              </button>
            )}
          </BotMessage>
        )}
        {crawlError && (
          <SystemNote tone="error">
            {t("Download failed: {message}", { message: stripUrls(crawlError) })}{" "}
            <button type="button" className="ml-1 font-medium underline" onClick={clearCrawlError}>
              {t("Dismiss")}
            </button>
          </SystemNote>
        )}
        {order !== null && chapters && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 border-t border-chat-rule pt-6">
            {nextOrder !== null ? (
              <button type="button" className={PRIMARY} onClick={() => stepThread(1)}>
                <Check size={18} strokeWidth={2} aria-hidden="true" />
                {t("Mark as read and go to next")}
                <ArrowDown size={16} aria-hidden="true" />
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 text-[14px] text-chat-dim">
                <CheckCheck size={18} className="text-chat-online" aria-hidden="true" />
                {t("You're all caught up")}
              </span>
            )}
            {previousOrder !== null && (
              <button type="button" className={SECONDARY} onClick={() => stepThread(-1)}>
                <ArrowUp size={16} aria-hidden="true" />
                {t("Previous thread")}
              </button>
            )}
            {nextOrder === null && !crawl && downloadButton}
          </div>
        )}
      </>
    );
  }

  let main: ReactNode;
  if (view.kind === "home") {
    main = (
      <HomeView
        rows={homeRows}
        loading={listLoading}
        error={listError ? stripUrls(listError) : null}
        onRetry={() => void reload()}
        onOpenDefault={() => app.openInDefault()}
        paging={homePaging}
      />
    );
  } else if (view.kind === "dm" && contact) {
    const groups: { from: string; time: string; lines: string[] }[] = [];
    for (const line of contact.lines) {
      const last = groups[groups.length - 1];
      if (last && last.from === line.from) last.lines.push(line.text);
      else groups.push({ from: line.from, time: line.time, lines: [line.text] });
    }
    main = (
      <>
        <ConversationHeader
          name={contact.name}
          tone={contact.tone}
          presence={contact.presence}
          status={contact.presence === "active" ? "Active" : contact.presence === "busy" ? "Do not disturb" : "Away"}
          space={false}
          onBack={goHome}
          onSearch={openPalette}
          labels={{ back: t("Back to the list"), search: t("Show and run commands") }}
        />
        <Conversation scrollerRef={scroller} label="Messages" restoreKey={`dm:${contact.id}`} startLine={0} ready>
          <DayDivider label={contact.day} />
          {groups.map((group, index) => (
            <MessageGroup
              key={index}
              name={group.from === "me" ? YOU.name : contact.name}
              tone={group.from === "me" ? YOU.tone : contact.tone}
              time={group.time}
              messages={group.lines.map((text, at) => ({ key: String(at), kind: "text", text }))}
            />
          ))}
          {echoGroup}
        </Conversation>
        <Composer
          inputRef={composer}
          placeholder={`Message ${contact.name}`}
          commands={slashCommands}
          onMessage={addEcho}
          onUnknown={(name) => setNotice(t("Unknown command: {name}", { name }))}
          sendLabel="Send message"
        />
      </>
    );
  } else {
    main = (
      <>
        <ConversationHeader
          name={openName}
          tone={storyId ? toneFor(storyId) : 1}
          initials={spaceInitials(openName)}
          status={
            crawlStatus ?? (
              <span className="truncate">
                {storyId ? `${memberCount(storyId)} members` : ""}
                {currentLabel && ` · ${currentLabel}`}
              </span>
            )
          }
          space
          onBack={goHome}
          onThreads={toggleThreads}
          threadsOpen={threadsOpen}
          onSearch={openPalette}
          onMore={(element) => menus.open("space", element)}
          labels={{ back: t("Back to the list"), search: t("Show and run commands") }}
        />
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <Conversation
              scrollerRef={scroller}
              label="Messages"
              restoreKey={`${storyId}:${order}#${openToken}`}
              startLine={startLine.current}
              ready={!!items}
              onTopLine={onTopLine}
            >
              {spaceBody}
            </Conversation>
            <Composer
              inputRef={composer}
              placeholder={`Message ${openName}`}
              commands={slashCommands}
              onMessage={addEcho}
              onUnknown={(name) => setNotice(t("Unknown command: {name}", { name }))}
              sendLabel="Send message"
            />
          </div>
          {threadsOpen && (
            <ThreadsPanel
              entries={threadEntries}
              loading={storyData.loading}
              summary={
                chapters
                  ? `${chapters.length} threads · ${readableOrders ? unreadExact(readableOrders, savedOrder) : 0} unread`
                  : ""
              }
              paging={threadPaging}
              onClose={() => setThreadsOpen(false)}
              footer={
                crawl
                  ? crawlStatus && <span className="flex items-center gap-1.5 text-chat-dim">{crawlStatus}</span>
                  : pendingCount > 0 && (
                      <span className="flex flex-wrap items-center gap-x-2 text-chat-dim">
                        {t("{count} not downloaded yet", { count: pendingCount })}
                        {crawlCommand && (
                          <button type="button" className={TEXT_LINK} onClick={crawlCommand.run}>
                            {crawlCommand.label}
                          </button>
                        )}
                      </span>
                    )
              }
            />
          )}
        </div>
      </>
    );
  }

  return (
    <div ref={root} className="relative flex h-full flex-col overflow-hidden bg-chat-app font-chat text-chat-fg">
      <TopBar
        onMenu={() => setRailOpen((open) => !open)}
        onSearch={openPalette}
        onSettings={app.openSettings}
        onAccount={(element) => menus.open("account", element)}
        labels={{ menu: "Main menu", search: t("Show and run commands"), settings: t("Settings") }}
      />
      <div className="relative flex min-h-0 flex-1">
        {railOpen && (
          <>
            <div
              className="absolute inset-0 z-20 bg-black/20 md:hidden"
              aria-hidden="true"
              onMouseDown={() => setRailOpen(false)}
            />
            <Rail
              home={{ active: view.kind === "home", onClick: goHome }}
              onNewChat={openPalette}
              contacts={railContacts}
              spaces={railSpaces}
              footer={railFooter}
              labels={{ nav: "Chat", contacts: "Direct messages", spaces: "Spaces" }}
            />
          </>
        )}
        <main
          className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-chat-surface md:mb-3 md:mr-3 md:rounded-2xl ${
            railOpen ? "" : "md:ml-3"
          }`}
        >
          {main}
        </main>
      </div>
      {notice && (
        <div
          role="status"
          className="fixed bottom-6 left-6 z-50 max-w-[min(420px,calc(100vw-48px))] rounded-lg bg-chat-snack px-4 py-3 text-[14px] text-chat-snack-fg shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
        >
          {notice}
        </div>
      )}
      <AppMenu
        anchor={menus.menu?.anchor ?? null}
        entries={menus.menu?.id === "space" ? spaceMenu : accountMenu}
        onClose={menus.close}
        tone="chat"
        label={menus.menu?.id === "space" ? "More options" : "Account"}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={allCommands}
        placeholder={t("Type a command")}
        tone="chat"
      />
    </div>
  );
}
