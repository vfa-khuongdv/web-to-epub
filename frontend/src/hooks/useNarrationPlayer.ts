import { useCallback, useEffect, useRef, useState } from "react";
import { chapterAudioUrl } from "../lib/api";

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

export interface NarrationPlayer {
  // The chapter loaded in the player, or null when nothing is.
  order: number | null;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  error: string | null;
  // Where the reader left off in this story, if that chapter still has audio.
  resumeOrder: number | undefined;
  hasNext: boolean;
  hasPrevious: boolean;
  play: (order: number) => void;
  toggle: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
  next: () => void;
  previous: () => void;
  setRate: (rate: number) => void;
  close: () => void;
}

/**
 * The story page's audio player: one <audio> element shared by the chapter list and the
 * reader, so opening the reader does not interrupt what is playing. Plays the chapters
 * that have narration in reading order, moving on by itself when one ends, and remembers
 * the position per story in this browser.
 */
export function useNarrationPlayer(storyId: string, isPrivate: boolean, ready: number[]): NarrationPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const orderRef = useRef<number | null>(null);
  const lastSaved = useRef(0);

  const [order, setOrder] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(readRate);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(() => readPosition(storyId, isPrivate));

  const audio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "metadata";
    }
    return audioRef.current;
  }, []);

  const save = useCallback(
    (position: SavedPosition | undefined) => {
      writePosition(storyId, isPrivate, position);
      setSaved(position);
    },
    [storyId, isPrivate]
  );

  const load = useCallback(
    (next: number, startAt: number) => {
      const el = audio();
      orderRef.current = next;
      setOrder(next);
      setTime(startAt);
      setDuration(0);
      setError(null);
      el.src = chapterAudioUrl(storyId, next);
      el.playbackRate = rate;
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
    [audio, storyId, rate]
  );

  const play = useCallback(
    (next: number) => {
      const el = audio();
      if (orderRef.current === next && el.src) {
        void el.play();
        return;
      }
      const resumeAt = saved?.order === next ? saved.time : 0;
      load(next, resumeAt);
    },
    [audio, load, saved]
  );

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
      const following = current === null ? undefined : nextOrder(readyRef.current, current);
      if (following !== undefined) {
        save({ order: following, time: 0 });
        load(following, 0);
      } else {
        save(undefined);
        setPlaying(false);
      }
    };
    const onError = () => {
      if (el.src) setError("error");
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

  // Leaving the story stops it: the player belongs to the story page.
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

  const close = useCallback(() => {
    const el = audio();
    el.pause();
    el.removeAttribute("src");
    el.load();
    orderRef.current = null;
    setOrder(null);
    setPlaying(false);
    setTime(0);
    setDuration(0);
  }, [audio]);

  // A chapter whose audio went stale (edited) or was removed cannot keep playing.
  useEffect(() => {
    if (order !== null && !ready.includes(order)) close();
  }, [ready, order, close]);

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

  const current = order ?? -1;
  return {
    order,
    playing,
    time,
    duration,
    rate,
    error,
    resumeOrder: saved && ready.includes(saved.order) ? saved.order : undefined,
    hasNext: order !== null && nextOrder(ready, current) !== undefined,
    hasPrevious: order !== null && previousOrder(ready, current) !== undefined,
    play,
    toggle: () => {
      const el = audio();
      if (order === null) return;
      if (el.paused) void el.play();
      else el.pause();
    },
    seek: (to) => {
      audio().currentTime = Math.max(0, Math.min(to, duration || to));
    },
    skip: (seconds) => {
      const el = audio();
      el.currentTime = Math.max(0, Math.min(el.currentTime + seconds, duration || el.currentTime + seconds));
    },
    next: () => {
      const following = order === null ? undefined : nextOrder(ready, order);
      if (following !== undefined) load(following, 0);
    },
    previous: () => {
      const before = order === null ? undefined : previousOrder(ready, order);
      if (before !== undefined) load(before, 0);
    },
    setRate,
    close,
  };
}
