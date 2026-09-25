import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { chapterAudioUrl } from "../lib/api";
import { useVault } from "../vault";

export const PLAYBACK_RATES = [0.8, 1, 1.25, 1.5, 1.75, 2] as const;
const RATE_KEY = "narration-rate";
// Position is saved this often while playing, and on every pause.
const SAVE_EVERY_S = 5;
// Closer than this to the end counts as finished: resuming there would play a second of silence.
const FINISHED_MARGIN_S = 3;

export interface SavedPosition {
  order: number;
  time: number;
}

// The chapter after / before `order` among those that have audio, in reading order.
export function nextOrder(ready: number[], order: number): number | undefined {
  return ready.find((o) => o > order);
}

export function previousOrder(ready: number[], order: number): number | undefined {
  return [...ready].reverse().find((o) => o < order);
}

// One saved position per story and library, like the reader's (a story id is a hash of
// its URL, so the same story can sit in both libraries).
function positionKey(storyId: string, isPrivate: boolean): string {
  return `narration-position:${isPrivate ? "private" : "public"}:${storyId}`;
}

// localStorage can be missing or throw (private windows, blocked storage): the player
// then simply does not remember, it never fails.
export function readPosition(storyId: string, isPrivate: boolean): SavedPosition | undefined {
  try {
    const raw = localStorage.getItem(positionKey(storyId, isPrivate));
    const saved = raw ? (JSON.parse(raw) as Partial<SavedPosition>) : undefined;
    return saved && Number.isInteger(saved.order) && typeof saved.time === "number"
      ? { order: saved.order!, time: saved.time }
      : undefined;
  } catch {
    return undefined;
  }
}

export function writePosition(storyId: string, isPrivate: boolean, position: SavedPosition | undefined): void {
  try {
    const key = positionKey(storyId, isPrivate);
    if (position) localStorage.setItem(key, JSON.stringify(position));
    else localStorage.removeItem(key);
  } catch {
    /* not remembered, nothing else */
  }
}

export function readRate(): number {
  try {
    const saved = Number(localStorage.getItem(RATE_KEY));
    return (PLAYBACK_RATES as readonly number[]).includes(saved) ? saved : 1;
  } catch {
    return 1;
  }
}

// What the player plays through: one story's chapters that have narration, in reading
// order, with their titles for the bar.
export interface PlayerQueue {
  storyId: string;
  storyTitle: string;
  orders: number[];
  titles: Record<number, string>;
}

export interface NarrationPlayer {
  // The story and chapter loaded in the player, or null when nothing is.
  storyId: string | null;
  storyTitle: string;
  order: number | null;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  error: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
  titleOf: (order: number) => string;
  // Whether this chapter of this story is the one playing right now.
  isPlaying: (storyId: string, order: number) => boolean;
  // Play `order` from `queue` (switching story if needed); the same chapter resumes.
  play: (queue: PlayerQueue, order: number) => void;
  // A story page refreshes its own queue (a chapter got narrated, one went stale); only
  // applied when that story is the one loaded.
  updateQueue: (queue: PlayerQueue) => void;
  toggle: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
  next: () => void;
  previous: () => void;
  setRate: (rate: number) => void;
  close: () => void;
  // "Show me what is playing": the library opens that story and its reader at the chapter.
  openRequest: { storyId: string; order: number } | null;
  requestOpen: (storyId: string, order: number) => void;
  clearOpenRequest: () => void;
}

const PlayerContext = createContext<NarrationPlayer | null>(null);

export function useNarrationPlayer(): NarrationPlayer {
  const player = useContext(PlayerContext);
  if (!player) throw new Error("useNarrationPlayer outside NarrationPlayerProvider");
  return player;
}

/**
 * The app's narration player: one <audio> element for the whole library, so browsing
 * to another story, opening the reader or going back to the list never interrupts what
 * is playing. Plays a story's narrated chapters in reading order, moving on by itself
 * when one ends, and remembers the position per story in this browser. Mounted inside
 * App, which is remounted when switching library — locking private mode stops it.
 */
export function NarrationPlayerProvider({ children }: { children: ReactNode }) {
  const isPrivate = useVault().active;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<PlayerQueue | null>(null);
  const orderRef = useRef<number | null>(null);
  const lastSaved = useRef(0);

  const [queue, setQueue] = useState<PlayerQueue | null>(null);
  const [order, setOrder] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(readRate);
  const [error, setError] = useState<string | null>(null);
  const [openRequest, setOpenRequest] = useState<{ storyId: string; order: number } | null>(null);
  const requestOpen = useCallback((storyId: string, o: number) => setOpenRequest({ storyId, order: o }), []);
  const clearOpenRequest = useCallback(() => setOpenRequest(null), []);
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const audio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "metadata";
    }
    return audioRef.current;
  }, []);

  const save = useCallback(
    (position: SavedPosition | undefined) => {
      const current = queueRef.current;
      if (current) writePosition(current.storyId, isPrivate, position);
    },
    [isPrivate]
  );

  const setQueueBoth = useCallback((next: PlayerQueue | null) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const load = useCallback(
    (next: number, startAt: number) => {
      const el = audio();
      const current = queueRef.current;
      if (!current) return;
      orderRef.current = next;
      lastSaved.current = startAt;
      setOrder(next);
      setTime(startAt);
      setDuration(0);
      setError(null);
      el.src = chapterAudioUrl(current.storyId, next);
      el.playbackRate = rateRef.current;
      if (startAt > 0) {
        const seekOnce = () => {
          el.currentTime = startAt;
          el.removeEventListener("loadedmetadata", seekOnce);
        };
        el.addEventListener("loadedmetadata", seekOnce);
      }
      el.play().catch((err: Error) => {
        // A pause() racing play() is not an error worth showing.
        if (err.name !== "AbortError") setError(err.message);
      });
    },
    [audio]
  );

  const close = useCallback(() => {
    const el = audio();
    el.pause();
    el.removeAttribute("src");
    el.load();
    orderRef.current = null;
    setQueueBoth(null);
    setOrder(null);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setError(null);
  }, [audio, setQueueBoth]);

  // Element events → state. Attached once; handlers read refs, not stale state.
  useEffect(() => {
    const el = audio();
    const onTime = () => {
      setTime(el.currentTime);
      const current = orderRef.current;
      if (current !== null && Math.abs(el.currentTime - lastSaved.current) >= SAVE_EVERY_S) {
        lastSaved.current = el.currentTime;
        save({ order: current, time: el.currentTime });
      }
    };
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      const current = orderRef.current;
      if (current === null) return;
      const finished = el.duration > 0 && el.duration - el.currentTime < FINISHED_MARGIN_S;
      if (!finished) save({ order: current, time: el.currentTime });
    };
    const onEnded = () => {
      const current = orderRef.current;
      const orders = queueRef.current?.orders ?? [];
      const following = current === null ? undefined : nextOrder(orders, current);
      if (following !== undefined) {
        save({ order: following, time: 0 });
        load(following, 0);
      } else {
        save(undefined);
        setPlaying(false);
      }
    };
    const onError = () => {
      if (el.getAttribute("src")) setError("error");
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, [audio, load, save]);

  // Unmounting App (switching library) stops the audio: it belongs to that library.
  useEffect(
    () => () => {
      const el = audioRef.current;
      if (!el) return;
      el.pause();
      el.removeAttribute("src");
      el.load();
    },
    []
  );

  const play = useCallback(
    (next: PlayerQueue, chapter: number) => {
      const el = audio();
      const sameStory = queueRef.current?.storyId === next.storyId;
      setQueueBoth(next);
      if (sameStory && orderRef.current === chapter && el.getAttribute("src")) {
        void el.play();
        return;
      }
      const saved = readPosition(next.storyId, isPrivate);
      load(chapter, saved?.order === chapter ? saved.time : 0);
    },
    [audio, isPrivate, load, setQueueBoth]
  );

  const updateQueue = useCallback(
    (next: PlayerQueue) => {
      if (queueRef.current?.storyId !== next.storyId) return;
      setQueueBoth(next);
      // A chapter whose audio went stale (edited) or was removed cannot keep playing.
      const current = orderRef.current;
      if (current !== null && !next.orders.includes(current)) close();
    },
    [close, setQueueBoth]
  );

  const setRate = useCallback(
    (next: number) => {
      setRateState(next);
      audio().playbackRate = next;
      try {
        localStorage.setItem(RATE_KEY, String(next));
      } catch {
        /* not remembered */
      }
    },
    [audio]
  );

  const value = useMemo<NarrationPlayer>(() => {
    const orders = queue?.orders ?? [];
    const current = order ?? -1;
    return {
      storyId: queue?.storyId ?? null,
      storyTitle: queue?.storyTitle ?? "",
      order,
      playing,
      time,
      duration,
      rate,
      error,
      hasNext: order !== null && nextOrder(orders, current) !== undefined,
      hasPrevious: order !== null && previousOrder(orders, current) !== undefined,
      titleOf: (o) => queue?.titles[o] ?? "",
      isPlaying: (storyId, o) => playing && queue?.storyId === storyId && order === o,
      play,
      updateQueue,
      toggle: () => {
        const el = audio();
        if (orderRef.current === null) return;
        if (el.paused) void el.play();
        else el.pause();
      },
      seek: (to) => {
        audio().currentTime = Math.max(0, Math.min(to, duration || to));
      },
      skip: (seconds) => {
        const el = audio();
        const to = el.currentTime + seconds;
        el.currentTime = Math.max(0, Math.min(to, duration || to));
      },
      next: () => {
        const following = order === null ? undefined : nextOrder(orders, order);
        if (following !== undefined) load(following, 0);
      },
      previous: () => {
        const before = order === null ? undefined : previousOrder(orders, order);
        if (before !== undefined) load(before, 0);
      },
      setRate,
      close,
      openRequest,
      requestOpen,
      clearOpenRequest,
    };
  }, [
    queue,
    order,
    playing,
    time,
    duration,
    rate,
    error,
    openRequest,
    play,
    updateQueue,
    setRate,
    close,
    audio,
    load,
    requestOpen,
    clearOpenRequest,
  ]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
