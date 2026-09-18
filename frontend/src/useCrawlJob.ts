import { useCallback, useRef, useState } from "react";
import { ProgressEvent } from "./types";

export interface CrawlLogLine {
  at: string;
  text: string;
  isError: boolean;
}

export type ChapterLiveState = "running" | "done" | "error";

export interface CrawlJobState {
  label: string;
  running: boolean;
  pct: number;
  cursor: number;
  total: number;
  errors: number;
  log: CrawlLogLine[];
  // Estimated time remaining (ms) for running crawl; undefined when not enough
  // samples or crawl is done.
  etaMs?: number;
  // Status of each chapter in running crawl, by URL. Backend explicitly reports
  // chapter done ("chapter-done") or failed ("error"), rather than inferring from
  // next chapter starting — that inference misses the last chapter since nothing
  // starts after it. Views only overlay pending chapters, so server data always
  // wins after refetch.
  chapters: Record<string, ChapterLiveState>;
}

const IDLE: CrawlJobState = {
  label: "",
  running: false,
  pct: 0,
  cursor: 0,
  total: 0,
  errors: 0,
  log: [],
  chapters: {},
};

// Crawling hundreds of chapters (plus retries) generates thousands of log lines,
// and each new line copies the whole array and re-renders the list. Keep only
// the end — also the only part users read.
const MAX_LOG_LINES = 500;

function appendLog(log: CrawlLogLine[], line: CrawlLogLine): CrawlLogLine[] {
  const next = [...log, line];
  return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
}

export function advanceChapterStates(
  states: Record<string, ChapterLiveState>,
  url: string,
  next: ChapterLiveState
): Record<string, ChapterLiveState> {
  return { ...states, [url]: next };
}

export type RunCrawl = (
  label: string,
  stream: (emit: (event: ProgressEvent) => void) => Promise<void>,
  onEvent?: (event: ProgressEvent) => void
) => Promise<void>;

// Chapters the running crawl has finished (or failed) but whose stored status is
// still `pending`: views add these on top of server's counts, so in-progress crawl
// shows without waiting for final refetch.
export function liveCounts(
  chapters: { url: string; status: string }[],
  states: Record<string, ChapterLiveState>
): { done: number; error: number } {
  let done = 0;
  let error = 0;
  for (const chapter of chapters) {
    if (chapter.status !== "pending") continue;
    const state = states[chapter.url];
    if (state === "done") done++;
    else if (state === "error") error++;
  }
  return { done, error };
}

// Events from shared channel: like per-story events but with added storyId,
// and initial snapshot listing all running crawls.
interface LiveSnapshot {
  type: "snapshot";
  crawls?: { storyId: string; cursor: number; total: number; etaMs?: number }[];
}

type LiveEvent = (ProgressEvent & { storyId?: string }) | LiveSnapshot;

export interface LiveCrawl {
  cursor: number;
  total: number;
  etaMs?: number;
}

function stamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

// Streams one crawl run into the docked job strip and hands every event back to
// the caller so the view can keep its own chapter list in step. A dropped
// connection becomes a log line instead of an unhandled rejection: the backend
// keeps crawling and saving per chapter either way.
export function useCrawlJob() {
  const [job, setJob] = useState<CrawlJobState>(IDLE);
  // Which story is crawling, for ALL stories not just the open story: the library
  // table shows "Crawling" chip without needing to select story.
  const [live, setLive] = useState<Record<string, LiveCrawl | undefined>>({});
  const liveRef = useRef(live);
  liveRef.current = live;
  const watchedId = useRef<string | null>(null);
  const liveSource = useRef<EventSource | null>(null);

  const applyEvent = useCallback((event: ProgressEvent, onEvent?: (event: ProgressEvent) => void) => {
    if (event.type === "progress" && event.index !== undefined && event.total) {
      // Backend `cursor` is chapters done; only infer from chapter position when
      // missing (manual crawl stream is inherently sequential).
      const cursor = event.cursor ?? event.index + 1;
      setJob((j) => ({
        ...j,
        // A progress event means a crawl is running — including one another
        // session started after this client attached to the live channel.
        running: true,
        cursor,
        total: event.total!,
        pct: (cursor / event.total!) * 100,
        etaMs: event.etaMs ?? j.etaMs,
        chapters: event.url ? advanceChapterStates(j.chapters, event.url, "running") : j.chapters,
        log: appendLog(j.log, {
          at: stamp(),
          text: `[${cursor}/${event.total}] ${event.url} — ${event.message}`,
          isError: false,
        }),
      }));
    } else if (event.type === "error" && event.index !== undefined && event.total) {
      const cursor = event.cursor ?? event.index + 1;
      setJob((j) => ({
        ...j,
        running: true,
        cursor,
        total: event.total!,
        errors: j.errors + 1,
        etaMs: event.etaMs ?? j.etaMs,
        chapters: event.url ? advanceChapterStates(j.chapters, event.url, "error") : j.chapters,
        log: appendLog(j.log, {
          at: stamp(),
          text: `[${cursor}/${event.total}] ${event.url} — ${event.message}`,
          isError: true,
        }),
      }));
    } else if (event.type === "chapter-done") {
      const cursor = event.cursor ?? 0;
      const total = event.total ?? 0;
      setJob((j) => ({
        ...j,
        running: true,
        cursor: total > 0 ? cursor : j.cursor,
        total: total || j.total,
        pct: total > 0 ? (cursor / total) * 100 : j.pct,
        etaMs: event.etaMs ?? j.etaMs,
        chapters: event.url ? advanceChapterStates(j.chapters, event.url, "done") : j.chapters,
      }));
    } else if (event.type === "done") {
      setJob((j) => ({ ...j, cursor: j.total, pct: 100, etaMs: undefined }));
    }
    onEvent?.(event);
  }, []);

  const run = useCallback(
    async (
      label: string,
      stream: (emit: (event: ProgressEvent) => void) => Promise<void>,
      onEvent?: (event: ProgressEvent) => void
    ) => {
      setJob({ ...IDLE, label, running: true });
      try {
        await stream((event) => applyEvent(event, onEvent));
      } catch (err) {
        setJob((j) => ({
          ...j,
          log: appendLog(j.log, { at: stamp(), text: `Connection error: ${(err as Error).message}`, isError: true }),
        }));
      } finally {
        setJob((j) => ({ ...j, running: false }));
      }
    },
    [applyEvent]
  );

  // Open shared realtime channel (once for app): all running crawls pushed here
  // with storyId, so a just-reloaded session — or one that never started crawl —
  // still sees correct status for all stories.
  const subscribe = useCallback(() => {
    liveSource.current?.close();
    const source = new EventSource("/api/stories/live");
    liveSource.current = source;

    source.onmessage = (message) => {
      let event: LiveEvent;
      try {
        event = JSON.parse(message.data) as LiveEvent;
      } catch {
        return;
      }

      if (event.type === "snapshot") {
        const next: Record<string, LiveCrawl | undefined> = {};
        for (const crawl of event.crawls ?? []) {
          next[crawl.storyId] = { cursor: crawl.cursor, total: crawl.total, etaMs: crawl.etaMs };
        }
        setLive(next);
        // After connection loss, snapshot is truth: resync the open story
        // (crawl may have finished while listening failed).
        const watched = watchedId.current ? next[watchedId.current] : undefined;
        setJob((j) => ({
          ...j,
          running: !!watched,
          cursor: watched?.cursor ?? j.cursor,
          total: watched?.total ?? j.total,
          pct: watched && watched.total > 0 ? (watched.cursor / watched.total) * 100 : j.pct,
          etaMs: watched?.etaMs,
        }));
        return;
      }

      const storyId = event.storyId;
      if (!storyId) return;
      if (event.type === "idle") {
        setLive((l) => ({ ...l, [storyId]: undefined }));
      } else if (event.type !== "done") {
        setLive((l) => ({
          ...l,
          [storyId]: {
            cursor: event.cursor ?? l[storyId]?.cursor ?? 0,
            total: event.total ?? l[storyId]?.total ?? 0,
            etaMs: event.etaMs ?? l[storyId]?.etaMs,
          },
        }));
      }

      // Log and per-chapter state belong only to the open story.
      if (storyId !== watchedId.current) return;
      if (event.type === "running") {
        const cursor = event.cursor ?? 0;
        const total = event.total ?? 0;
        setJob((j) => ({ ...j, running: true, cursor, total, pct: total > 0 ? (cursor / total) * 100 : 0 }));
        return;
      }
      if (event.type === "idle") {
        setJob((j) => ({ ...j, running: false }));
        return;
      }
      applyEvent(event);
    };

    // EventSource auto-reconnects on network loss.
    return () => {
      source.close();
      if (liveSource.current === source) liveSource.current = null;
    };
  }, [applyEvent]);

  // Switch to viewing a story: log resets from shared channel's current state
  // (crawling stories show correct progress immediately, don't wait for events).
  const attach = useCallback((label: string, storyId: string) => {
    watchedId.current = storyId;
    const current = liveRef.current[storyId];
    setJob({
      ...IDLE,
      label,
      running: !!current,
      cursor: current?.cursor ?? 0,
      total: current?.total ?? 0,
      pct: current && current.total > 0 ? (current.cursor / current.total) * 100 : 0,
      etaMs: current?.etaMs,
    });
    return () => {
      if (watchedId.current === storyId) watchedId.current = null;
    };
  }, []);

  // Drop the live per-chapter overlay once the view has refetched the run's
  // chapters from the server: after that the server's own status is the truth.
  const clearChapters = useCallback(() => {
    setJob((j) => ({ ...j, chapters: {} }));
  }, []);

  return { job, live, run, attach, subscribe, clearChapters };
}
