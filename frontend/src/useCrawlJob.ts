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
  // Live state per chapter URL for the run in progress: the backend only sends
  // per-attempt progress and per-failure errors, so a chapter counts as done
  // once the next chapter's progress arrives without an error for it. Views
  // apply this only to chapters they still show as pending, so the server's
  // own data always wins once it is refetched.
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

export function advanceChapterStates(
  states: Record<string, ChapterLiveState>,
  url: string,
  next: ChapterLiveState
): Record<string, ChapterLiveState> {
  const updated: Record<string, ChapterLiveState> = { ...states };
  if (next === "running") {
    // Anything still marked running is a chapter the crawl has moved past;
    // an error would have marked it already.
    for (const [key, value] of Object.entries(updated)) {
      if (value === "running" && key !== url) updated[key] = "done";
    }
  }
  updated[url] = next;
  return updated;
}

export type RunCrawl = (
  label: string,
  stream: (emit: (event: ProgressEvent) => void) => Promise<void>,
  onEvent?: (event: ProgressEvent) => void
) => Promise<void>;

// Chapters the running crawl has finished (or failed) but whose stored status
// is still `pending`: the views add these on top of the server's own counts, so
// a crawl in progress shows up without waiting for the final refetch.
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

// Sự kiện từ kênh chung: giống sự kiện theo truyện nhưng có thêm storyId, và
// ảnh chụp đầu kết nối liệt kê mọi crawl đang chạy.
interface LiveSnapshot {
  type: "snapshot";
  crawls?: { storyId: string; cursor: number; total: number }[];
}

type LiveEvent = (ProgressEvent & { storyId?: string }) | LiveSnapshot;

export interface LiveCrawl {
  cursor: number;
  total: number;
}

function stamp(): string {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

// Streams one crawl run into the docked job strip and hands every event back to
// the caller so the view can keep its own chapter list in step. A dropped
// connection becomes a log line instead of an unhandled rejection: the backend
// keeps crawling and saving per chapter either way.
export function useCrawlJob() {
  const [job, setJob] = useState<CrawlJobState>(IDLE);
  // Truyện nào đang crawl, cho MỌI truyện chứ không riêng truyện đang mở: bảng
  // thư viện hiện chip "Đang crawl" mà không cần chọn truyện.
  const [live, setLive] = useState<Record<string, LiveCrawl | undefined>>({});
  const liveRef = useRef(live);
  liveRef.current = live;
  const watchedId = useRef<string | null>(null);
  const liveSource = useRef<EventSource | null>(null);

  const applyEvent = useCallback((event: ProgressEvent, onEvent?: (event: ProgressEvent) => void) => {
    if (event.type === "progress" && event.index !== undefined && event.total) {
      const cursor = event.index + 1;
      setJob((j) => ({
        ...j,
        // A progress event means a crawl is running — including one another
        // session started after this client attached to the live channel.
        running: true,
        cursor,
        total: event.total!,
        pct: (cursor / event.total!) * 100,
        chapters: event.url ? advanceChapterStates(j.chapters, event.url, "running") : j.chapters,
        log: [
          ...j.log,
          { at: stamp(), text: `[${cursor}/${event.total}] ${event.url} — ${event.message}`, isError: false },
        ],
      }));
    } else if (event.type === "error" && event.index !== undefined && event.total) {
      const cursor = event.index + 1;
      setJob((j) => ({
        ...j,
        running: true,
        cursor,
        total: event.total!,
        errors: j.errors + 1,
        chapters: event.url ? advanceChapterStates(j.chapters, event.url, "error") : j.chapters,
        log: [
          ...j.log,
          { at: stamp(), text: `[${cursor}/${event.total}] ${event.url} — ${event.message}`, isError: true },
        ],
      }));
    } else if (event.type === "done") {
      setJob((j) => ({ ...j, cursor: j.total, pct: 100 }));
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
          log: [...j.log, { at: stamp(), text: `Lỗi kết nối: ${(err as Error).message}`, isError: true }],
        }));
      } finally {
        setJob((j) => ({ ...j, running: false }));
      }
    },
    [applyEvent]
  );

  // Mở kênh realtime chung (một lần cho cả app): mọi crawl đang chạy đều được
  // đẩy về đây kèm storyId, nên phiên vừa reload — hoặc chưa từng bấm crawl —
  // vẫn thấy đúng trạng thái của mọi truyện.
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
          next[crawl.storyId] = { cursor: crawl.cursor, total: crawl.total };
        }
        setLive(next);
        // Sau khi mất kết nối, ảnh chụp là sự thật: đồng bộ lại truyện đang mở
        // (crawl có thể đã kết thúc trong lúc không nghe được).
        const watched = watchedId.current ? next[watchedId.current] : undefined;
        setJob((j) => ({
          ...j,
          running: !!watched,
          cursor: watched?.cursor ?? j.cursor,
          total: watched?.total ?? j.total,
          pct: watched && watched.total > 0 ? (watched.cursor / watched.total) * 100 : j.pct,
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
          },
        }));
      }

      // Nhật ký và trạng thái từng chương chỉ thuộc về truyện đang mở.
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

    // EventSource tự kết nối lại khi mất mạng.
    return () => {
      source.close();
      if (liveSource.current === source) liveSource.current = null;
    };
  }, [applyEvent]);

  // Chuyển sang xem một truyện: nhật ký bắt đầu lại từ trạng thái hiện tại của
  // kênh chung (truyện đang crawl thì hiện đúng tiến độ ngay, không chờ sự kiện).
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
