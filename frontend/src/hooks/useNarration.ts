import { useCallback, useEffect, useRef, useState } from "react";
import { fetchNarration, startNarration, stopNarration } from "../lib/api";
import { NarrationRun, NarrationState } from "../types";
import { currentVaultToken } from "../vault/token";

// What routes/narration.ts sends on /api/narration/live (tagged with storyId).
type NarrationLiveEvent =
  | { type: "snapshot"; narrations: (NarrationRun & { storyId: string })[] }
  | ({ storyId: string } & (
      | { type: "narrate-running"; done: number; total: number }
      | { type: "narrate-progress"; order: number; part: number; parts: number; done: number; total: number }
      | { type: "narrate-chapter-done"; order: number; seconds: number; skipped: boolean; done: number; total: number; etaMs?: number }
      | { type: "narrate-error"; order?: number; message: string; done: number; total: number; etaMs?: number }
      | { type: "narrate-idle"; done: number; failed: number; total: number; cancelled: boolean }
    ));

export interface NarrationOutcome {
  done: number;
  failed: number;
  total: number;
  cancelled: boolean;
  // The last chapter error, shown with the outcome so a failing model is not silent.
  lastError?: string;
}

/**
 * Narration state for one story page: which chapters have audio, and the job in flight.
 * The job runs server-side, so a reload picks it up again from the live channel's snapshot.
 */
export function useNarration(storyId: string, enabled: boolean, version?: string) {
  const [state, setState] = useState<NarrationState | null>(null);
  const [outcome, setOutcome] = useState<NarrationOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastError = useRef<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      setState(await fetchNarration(storyId));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [storyId]);

  useEffect(() => {
    setState(null);
    setOutcome(null);
  }, [storyId]);

  // Again whenever the story changes (a crawl finished, a chapter was edited): an edited
  // chapter's audio is stale and must show as missing.
  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh, version]);

  const setRunning = useCallback((running: NarrationRun | null) => {
    setState((current) => (current ? { ...current, running } : current));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const token = currentVaultToken();
    const source = new EventSource(
      token ? `/api/narration/live?vault=${encodeURIComponent(token)}` : "/api/narration/live"
    );
    source.onmessage = (message) => {
      let event: NarrationLiveEvent;
      try {
        event = JSON.parse(message.data) as NarrationLiveEvent;
      } catch {
        return;
      }
      if (event.type === "snapshot") {
        const mine = event.narrations.find((run) => run.storyId === storyId);
        setRunning(mine ?? null);
        return;
      }
      if (event.storyId !== storyId) return;
      switch (event.type) {
        case "narrate-running":
          lastError.current = undefined;
          setOutcome(null);
          setRunning({ done: 0, total: event.total });
          break;
        case "narrate-progress":
          setState((current) =>
            current?.running
              ? { ...current, running: { ...current.running, order: event.order, part: event.part, parts: event.parts } }
              : current
          );
          break;
        case "narrate-chapter-done":
          setState((current) =>
            current
              ? {
                  ...current,
                  // A skipped chapter with no audio had nothing to read.
                  chapters:
                    event.skipped && event.seconds === 0
                      ? current.chapters
                      : { ...current.chapters, [event.order]: "ready" },
                  running: current.running ? { ...current.running, done: event.done, etaMs: event.etaMs } : null,
                }
              : current
          );
          break;
        case "narrate-error":
          lastError.current = event.message;
          setState((current) =>
            current?.running ? { ...current, running: { ...current.running, done: event.done, etaMs: event.etaMs } } : current
          );
          break;
        case "narrate-idle":
          setOutcome({ ...event, lastError: lastError.current });
          setRunning(null);
          // Sizes and states straight from disk once the job is over.
          void refresh();
          break;
      }
    };
    return () => source.close();
  }, [enabled, storyId, refresh, setRunning]);

  const start = useCallback(
    async (orders?: number[]) => {
      setError(null);
      try {
        await startNarration(storyId, orders);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [storyId]
  );

  const stop = useCallback(async () => {
    setError(null);
    try {
      await stopNarration(storyId);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [storyId]);

  return { state, outcome, error, start, stop, refresh, dismissOutcome: () => setOutcome(null) };
}
