import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRewriteState, startRewrite, stopRewrite } from "../lib/api";
import { RewriteRun, RewriteState } from "../types";
import { currentVaultToken } from "../vault/token";

// What routes/rewrite.ts sends on /api/rewrite/live (tagged with storyId).
type RewriteLiveEvent =
  | { type: "snapshot"; rewrites: ({ storyId: string } & RewriteRun)[] }
  | ({ storyId: string } & (
      | { type: "rewrite-running"; done: number; total: number; etaMs?: number }
      | { type: "rewrite-progress"; order: number; chunk: number; chunks: number; done: number; total: number }
      | { type: "rewrite-chapter-done"; order: number; skipped: boolean; done: number; total: number; etaMs?: number }
      | { type: "rewrite-error"; order?: number; message: string; done: number; total: number; etaMs?: number }
      | { type: "rewrite-idle"; done: number; failed: number; total: number; cancelled: boolean }
    ));

export interface RewriteOutcome {
  done: number;
  failed: number;
  total: number;
  cancelled: boolean;
  lastError?: string;
}

/**
 * Rewrite state for one story page: which chapters were rewritten, and the run in flight.
 * The job is server-side, so a reload picks it up again from the live channel's snapshot.
 */
export function useRewrite(
  storyId: string,
  enabled: boolean,
  options?: { onFinished?: (orders?: number[]) => void }
) {
  const [state, setState] = useState<RewriteState | null>(null);
  const [outcome, setOutcome] = useState<RewriteOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastError = useRef<string | undefined>();
  const requested = useRef<number[] | undefined>(undefined);
  const onFinished = useRef(options?.onFinished);
  onFinished.current = options?.onFinished;

  const refresh = useCallback(async () => {
    try {
      setState(await fetchRewriteState(storyId));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [storyId]);

  useEffect(() => {
    setState(null);
    setOutcome(null);
  }, [storyId]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const setRunning = useCallback((running: RewriteRun | null) => {
    setState((current) => (current ? { ...current, running } : current));
  }, []);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const token = currentVaultToken();
    const source = new EventSource(
      token ? `/api/rewrite/live?vault=${encodeURIComponent(token)}` : "/api/rewrite/live"
    );
    source.onmessage = (message) => {
      let event: RewriteLiveEvent;
      try {
        event = JSON.parse(message.data) as RewriteLiveEvent;
      } catch {
        return;
      }
      if (event.type === "snapshot") {
        const mine = event.rewrites.find((run) => run.storyId === storyId);
        setRunning(mine ?? null);
        return;
      }
      if (event.storyId !== storyId) return;
      switch (event.type) {
        case "rewrite-running":
          lastError.current = undefined;
          setOutcome(null);
          setRunning({ done: 0, total: event.total });
          break;
        case "rewrite-progress":
          setState((current) =>
            current?.running
              ? { ...current, running: { ...current.running, order: event.order, chunk: event.chunk, chunks: event.chunks } }
              : current
          );
          break;
        case "rewrite-chapter-done":
          setState((current) =>
            current
              ? {
                  ...current,
                  chapters: event.skipped
                    ? current.chapters
                    : { ...current.chapters, [event.order]: { ...current.chapters[event.order], rewritten: true } },
                  remaining: event.skipped ? current.remaining : Math.max(0, current.remaining - 1),
                  running: current.running ? { ...current.running, done: event.done, etaMs: event.etaMs } : null,
                }
              : current
          );
          break;
        case "rewrite-error":
          lastError.current = event.message;
          setState((current) =>
            current?.running ? { ...current, running: { ...current.running, done: event.done, etaMs: event.etaMs } } : current
          );
          break;
        case "rewrite-idle":
          setOutcome({ ...event, lastError: lastError.current });
          setRunning(null);
          void refresh();
          onFinished.current?.(requested.current);
          break;
      }
    };
    return () => source.close();
  }, [enabled, storyId, refresh, setRunning]);

  const start = useCallback(
    async (orders?: number[]) => {
      setError(null);
      requested.current = orders;
      try {
        await startRewrite(storyId, orders);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [storyId]
  );

  const stop = useCallback(async () => {
    setError(null);
    try {
      await stopRewrite(storyId);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [storyId]);

  return { state, outcome, error, start, stop, refresh, dismissOutcome: () => setOutcome(null) };
}
