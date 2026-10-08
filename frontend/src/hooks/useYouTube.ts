import { useCallback, useEffect, useRef, useState } from "react";
import { fetchYouTubeStory } from "../lib/api";
import { YouTubePhase, YouTubeRun, YouTubeState } from "../types";
import { currentVaultToken } from "../vault/token";

// What routes/youtube.ts sends on /api/youtube/live (tagged with storyId).
type YouTubeLiveEvent =
  | { type: "snapshot"; jobs: ({ storyId: string } & YouTubeRun)[] }
  | ({ storyId: string } & (
      | { type: "youtube-running"; phase: YouTubePhase; done: number; total: number; etaMs?: number; order?: number; percent?: number }
      | { type: "youtube-progress"; phase: YouTubePhase; order?: number; done: number; total: number; percent?: number }
      | {
          type: "youtube-chapter-done";
          phase: YouTubePhase;
          order: number;
          state: "done" | "error";
          message?: string;
          done: number;
          total: number;
          etaMs?: number;
        }
      | { type: "youtube-idle"; phase: YouTubePhase; done: number; failed: number; total: number; cancelled: boolean; message?: string }
      | { type: "youtube-error"; phase: YouTubePhase; message: string }
    ));

export interface YouTubeOutcome {
  phase: YouTubePhase;
  done: number;
  failed: number;
  total: number;
  cancelled: boolean;
  message?: string;
  lastError?: string;
}

/**
 * YouTube panel state for one story, kept current by the job channel: the chapter list and
 * records are re-read from the server when a chapter finishes, so the table always shows
 * what is on disk.
 */
export function useYouTube(storyId: string, enabled: boolean) {
  const [state, setState] = useState<YouTubeState | null>(null);
  const [outcome, setOutcome] = useState<YouTubeOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastError = useRef<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      setState(await fetchYouTubeStory(storyId));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [storyId]);

  useEffect(() => {
    setState(null);
    setOutcome(null);
    setError(null);
  }, [storyId]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const setRunning = useCallback((running: YouTubeRun | null) => {
    setState((current) => (current ? { ...current, running } : current));
  }, []);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const token = currentVaultToken();
    const source = new EventSource(
      token ? `/api/youtube/live?vault=${encodeURIComponent(token)}` : "/api/youtube/live"
    );
    source.onmessage = (message) => {
      let event: YouTubeLiveEvent;
      try {
        event = JSON.parse(message.data) as YouTubeLiveEvent;
      } catch {
        return;
      }
      if (event.type === "snapshot") {
        const mine = event.jobs.find((job) => job.storyId === storyId);
        setRunning(mine ?? null);
        return;
      }
      if (event.storyId !== storyId) return;
      switch (event.type) {
        case "youtube-running":
          lastError.current = undefined;
          setOutcome(null);
          setRunning({ phase: event.phase, done: 0, total: event.total });
          break;
        case "youtube-progress":
          setState((current) =>
            current?.running
              ? { ...current, running: { ...current.running, order: event.order, percent: event.percent } }
              : current
          );
          break;
        case "youtube-chapter-done":
          if (event.state === "error") lastError.current = event.message;
          setState((current) =>
            current?.running
              ? { ...current, running: { ...current.running, done: event.done, etaMs: event.etaMs, order: event.order } }
              : current
          );
          void refresh();
          break;
        case "youtube-error":
          lastError.current = event.message;
          break;
        case "youtube-idle":
          setOutcome({ ...event, lastError: lastError.current });
          setRunning(null);
          void refresh();
          break;
      }
    };
    return () => source.close();
  }, [enabled, storyId, refresh, setRunning]);

  return { state, outcome, error, setError, refresh, dismissOutcome: () => setOutcome(null) };
}
