import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { chapterAudioUrl, fetchMusicTracks, musicAudioUrl } from "../lib/api";
import { useVault } from "../vault";

export const PLAYBACK_RATES = [0.8, 1, 1.25, 1.5, 1.75, 2] as const;
// Seconds the player jumps with the ±15 buttons and the arrow keys.
export const SKIP_S = 15;
const RATE_KEY = "narration-rate";
const VOLUME_KEY = "narration-volume";
const MUSIC_KEY = "narration-music";
const MUSIC_VOLUME_KEY = "narration-music-volume";
// Whether the picked track plays at all. Off until the user turns it on, so a track in the
// list does not mean music under every chapter. Kept here, beside the track and its volume,
// because all three are one preference in this browser.
const MUSIC_ENABLED_KEY = "narration-music-enabled";
// Background music starts well under the voice.
const DEFAULT_MUSIC_VOLUME = 0.3;
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

// What the queue popover lists: the chapter playing now and the narrated ones after it.
export function upNextOrders(orders: number[], order: number): number[] {
  return orders.filter((o) => o >= order);
}

// Keys the focused element already handles itself (typing, native controls, a button's
// own space/enter activation): the player's shortcuts stay out of their way.
export function handlesOwnKeys(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || tag === "a";
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

// Volume persists like speed; anything outside 0..1 is treated as unset.
function readFraction(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const saved = Number(raw);
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : fallback;
  } catch {
    return fallback;
  }
}

export function readVolume(): number {
  return readFraction(VOLUME_KEY, 1);
}

export function readMusicVolume(): number {
  return readFraction(MUSIC_VOLUME_KEY, DEFAULT_MUSIC_VOLUME);
}

// Stored in MUSIC_KEY when the user picks None. Keeping the key (rather than removing it)
// is what tells "the user wants no music" apart from "the user has not chosen yet" — only
// the second one gets the track the app ships as its default, once.
const MUSIC_NONE = "none";

// The background track picked in this browser, or null for none.
export function readMusicTrack(): string | null {
  try {
    const stored = localStorage.getItem(MUSIC_KEY);
    return stored && stored !== MUSIC_NONE ? stored : null;
  } catch {
    return null;
  }
}

// Whether the user has made a choice at all (a track, or None).
function readMusicChosen(): boolean {
  try {
    return localStorage.getItem(MUSIC_KEY) !== null;
  } catch {
    return false;
  }
}

// Music is on unless the user turned it off: the app ships tracks to play, and "off" has
// to be the thing that is remembered for it to stay off.
export function readMusicEnabled(): boolean {
  try {
    return localStorage.getItem(MUSIC_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

function remember(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* not remembered */
  }
}

// What the player plays through: one story's chapters that have narration, in reading
// order, with their titles for the bar.
export interface PlayerQueue {
  storyId: string;
  storyTitle: string;
  orders: number[];
  titles: Record<number, string>;
  // The story's cover as saved in the DB (internal path or the original URL), for the bar.
  coverUrl?: string;
}

export interface NarrationPlayer {
  // The story and chapter loaded in the player, or null when nothing is.
  storyId: string | null;
  storyTitle: string;
  // The loaded story's cover, as-is; the bar resolves it to a URL.
  coverUrl: string | null;
  order: number | null;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  volume: number;
  error: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
  // The chapter playing and the narrated ones after it — the queue popover.
  upNext: number[];
  titleOf: (order: number) => string;
  // Whether this chapter of this story is the one playing right now.
  isPlaying: (storyId: string, order: number) => boolean;
  // Play `order` from `queue` (switching story if needed); the same chapter resumes.
  play: (queue: PlayerQueue, order: number) => void;
  // A story page refreshes its own queue (a chapter got narrated, one went stale); only
  // applied when that story is the one loaded.
  updateQueue: (queue: PlayerQueue) => void;
  // Jump to a chapter of the loaded queue (the queue popover); starts from the top.
  jumpTo: (order: number) => void;
  toggle: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
  next: () => void;
  previous: () => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  // Background music: one uploaded track, looped under the voice while it plays.
  musicEnabled: boolean;
  musicTrack: string | null;
  musicVolume: number;
  setMusicEnabled: (enabled: boolean) => void;
  setMusicTrack: (id: string | null) => void;
  setMusicVolume: (volume: number) => void;
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
 * A second, looping <audio> plays the chosen background track whenever the voice plays.
 */
export function NarrationPlayerProvider({ children }: { children: ReactNode }) {
  const isPrivate = useVault().active;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<PlayerQueue | null>(null);
  const orderRef = useRef<number | null>(null);
  const lastSaved = useRef(0);

  const [queue, setQueue] = useState<PlayerQueue | null>(null);
  const [order, setOrder] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(readRate);
  const [volume, setVolumeState] = useState(readVolume);
  const [musicTrack, setMusicTrackState] = useState(readMusicTrack);
  const [musicEnabled, setMusicEnabledState] = useState(readMusicEnabled);
  const [musicVolume, setMusicVolumeState] = useState(readMusicVolume);
  const [error, setError] = useState<string | null>(null);
  const [openRequest, setOpenRequest] = useState<{ storyId: string; order: number } | null>(null);
  const requestOpen = useCallback((storyId: string, o: number) => setOpenRequest({ storyId, order: o }), []);
  const clearOpenRequest = useCallback(() => setOpenRequest(null), []);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const audio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "metadata";
      audioRef.current.volume = volumeRef.current;
    }
    return audioRef.current;
  }, []);

  const musicTrackRef = useRef(musicTrack);
  musicTrackRef.current = musicTrack;
  const musicEnabledRef = useRef(musicEnabled);
  musicEnabledRef.current = musicEnabled;
  const musicVolumeRef = useRef(musicVolume);
  musicVolumeRef.current = musicVolume;

  const music = useCallback(() => {
    if (!musicRef.current) {
      musicRef.current = new Audio();
      musicRef.current.loop = true;
      musicRef.current.volume = musicVolumeRef.current;
    }
    return musicRef.current;
  }, []);

  // Follows the voice: plays the chosen track while it plays, pauses when it stops. Only
  // when the user has turned background music on — the list is there either way.
  const startMusic = useCallback(() => {
    if (!musicEnabledRef.current) return;
    const track = musicTrackRef.current;
    if (!track) return;
    const el = music();
    const src = musicAudioUrl(track);
    if (el.getAttribute("src") !== src) el.src = src;
    el.play().catch(() => {
      /* a missing or unplayable track just stays silent */
    });
  }, [music]);

  const stopMusic = useCallback(() => {
    musicRef.current?.pause();
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
    stopMusic();
    el.removeAttribute("src");
    el.load();
    orderRef.current = null;
    setQueueBoth(null);
    setOrder(null);
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setError(null);
  }, [audio, setQueueBoth, stopMusic]);

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
    const onPlay = () => {
      setPlaying(true);
      startMusic();
    };
    const onPause = () => {
      setPlaying(false);
      // A chapter that ends pauses too; the music keeps going unless nothing follows.
      if (!el.ended) stopMusic();
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
        stopMusic();
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
  }, [audio, load, save, startMusic, stopMusic]);

  // The app ships a track to play by default (marked in tts/music/tracks.json), so apply
  // it once when the user has not chosen anything yet. Deliberately not written to
  // storage: it is the app's default, not the user's choice, so a later version changing
  // the marked track still reaches them.
  useEffect(() => {
    if (!musicEnabledRef.current || readMusicChosen()) return;
    let cancelled = false;
    fetchMusicTracks()
      .then(({ defaultId }) => {
        if (cancelled || !defaultId) return;
        musicTrackRef.current = defaultId;
        setMusicTrackState(defaultId);
      })
      .catch(() => {
        /* without a default there is simply no music until one is picked */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Unmounting App (switching library) stops the audio: it belongs to that library.
  useEffect(
    () => () => {
      for (const el of [audioRef.current, musicRef.current]) {
        if (!el) continue;
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
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

  const setVolume = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(1, next));
      setVolumeState(clamped);
      audio().volume = clamped;
      try {
        localStorage.setItem(VOLUME_KEY, String(clamped));
      } catch {
        /* not remembered */
      }
    },
    [audio]
  );

  // Turning it on with no track picked starts the first one, so the switch is enough on
  // its own; turning it off silences the music but leaves the track picked.
  const setMusicEnabled = useCallback(
    (enabled: boolean) => {
      musicEnabledRef.current = enabled;
      setMusicEnabledState(enabled);
      // "0", not the absence of the key: absent means on, which is the shipped default.
      remember(MUSIC_ENABLED_KEY, enabled ? null : "0");
      if (!enabled) stopMusic();
      // startMusic() on its own would start the music with the voice still silent.
      else if (audioRef.current && !audioRef.current.paused) startMusic();
    },
    [startMusic, stopMusic]
  );

  const setMusicTrack = useCallback(
    (next: string | null) => {
      musicTrackRef.current = next;
      setMusicTrackState(next);
      // None is remembered as a choice, so the app's default does not come back.
      remember(MUSIC_KEY, next ?? MUSIC_NONE);
      if (next && audioRef.current && !audioRef.current.paused) startMusic();
      else if (!next && musicRef.current) {
        musicRef.current.pause();
        musicRef.current.removeAttribute("src");
        musicRef.current.load();
      }
    },
    [startMusic]
  );

  const setMusicVolume = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(1, next));
      setMusicVolumeState(clamped);
      music().volume = clamped;
      remember(MUSIC_VOLUME_KEY, String(clamped));
    },
    [music]
  );

  // A chapter of the loaded queue, from its top (the queue popover).
  const jumpTo = useCallback(
    (next: number) => {
      const current = queueRef.current;
      if (current && current.orders.includes(next)) load(next, 0);
    },
    [load]
  );

  // Global keys while a chapter is loaded: space toggles, arrows seek, J/K change
  // chapter. Left alone while the focused element uses the key itself (typing, a focused
  // button) or a modifier is held, so shortcuts elsewhere keep working.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const current = orderRef.current;
      if (current === null) return;
      if (event.target instanceof HTMLElement && handlesOwnKeys(event.target)) return;
      const el = audioRef.current;
      if (!el) return;
      const orders = queueRef.current?.orders ?? [];
      const clampTo = (to: number) => Math.max(0, Math.min(to, Number.isFinite(el.duration) ? el.duration : to));
      switch (event.key) {
        case " ":
          event.preventDefault();
          if (el.paused) void el.play();
          else el.pause();
          return;
        case "ArrowLeft":
          event.preventDefault();
          el.currentTime = clampTo(el.currentTime - SKIP_S);
          return;
        case "ArrowRight":
          event.preventDefault();
          el.currentTime = clampTo(el.currentTime + SKIP_S);
          return;
        case "j":
        case "J": {
          const before = previousOrder(orders, current);
          if (before !== undefined) load(before, 0);
          return;
        }
        case "k":
        case "K": {
          const following = nextOrder(orders, current);
          if (following !== undefined) load(following, 0);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [load]);

  const value = useMemo<NarrationPlayer>(() => {
    const orders = queue?.orders ?? [];
    const current = order ?? -1;
    return {
      storyId: queue?.storyId ?? null,
      storyTitle: queue?.storyTitle ?? "",
      coverUrl: queue?.coverUrl ?? null,
      order,
      playing,
      time,
      duration,
      rate,
      volume,
      error,
      hasNext: order !== null && nextOrder(orders, current) !== undefined,
      hasPrevious: order !== null && previousOrder(orders, current) !== undefined,
      upNext: order === null ? [] : upNextOrders(orders, order),
      titleOf: (o) => queue?.titles[o] ?? "",
      isPlaying: (storyId, o) => playing && queue?.storyId === storyId && order === o,
      play,
      updateQueue,
      jumpTo,
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
      setVolume,
      musicEnabled,
      musicTrack,
      musicVolume,
      setMusicEnabled,
      setMusicTrack,
      setMusicVolume,
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
    volume,
    error,
    openRequest,
    play,
    updateQueue,
    jumpTo,
    setRate,
    setVolume,
    musicEnabled,
    musicTrack,
    musicVolume,
    setMusicEnabled,
    setMusicTrack,
    setMusicVolume,
    close,
    audio,
    load,
    requestOpen,
    clearOpenRequest,
  ]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
