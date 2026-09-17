import { useCallback, useState } from "react";
import { ProgressEvent } from "./types";

export interface CrawlLogLine {
  at: string;
  text: string;
  isError: boolean;
}

export interface CrawlJobState {
  label: string;
  running: boolean;
  pct: number;
  cursor: number;
  total: number;
  errors: number;
  log: CrawlLogLine[];
}

const IDLE: CrawlJobState = {
  label: "",
  running: false,
  pct: 0,
  cursor: 0,
  total: 0,
  errors: 0,
  log: [],
};

export type RunCrawl = (
  label: string,
  stream: (emit: (event: ProgressEvent) => void) => Promise<void>,
  onEvent?: (event: ProgressEvent) => void
) => Promise<void>;

function stamp(): string {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

// Streams one crawl run into the docked job strip and hands every event back to
// the caller so the view can keep its own chapter list in step. A dropped
// connection becomes a log line instead of an unhandled rejection: the backend
// keeps crawling and saving per chapter either way.
export function useCrawlJob() {
  const [job, setJob] = useState<CrawlJobState>(IDLE);

  const run = useCallback(
    async (
      label: string,
      stream: (emit: (event: ProgressEvent) => void) => Promise<void>,
      onEvent?: (event: ProgressEvent) => void
    ) => {
      setJob({ ...IDLE, label, running: true });
      try {
        await stream((event) => {
          if (event.type === "progress" && event.index !== undefined && event.total) {
            const cursor = event.index + 1;
            setJob((j) => ({
              ...j,
              cursor,
              total: event.total!,
              pct: (cursor / event.total!) * 100,
              log: [
                ...j.log,
                { at: stamp(), text: `[${cursor}/${event.total}] ${event.url} — ${event.message}`, isError: false },
              ],
            }));
          } else if (event.type === "error" && event.index !== undefined && event.total) {
            const cursor = event.index + 1;
            setJob((j) => ({
              ...j,
              cursor,
              total: event.total!,
              errors: j.errors + 1,
              log: [
                ...j.log,
                { at: stamp(), text: `[${cursor}/${event.total}] ${event.url} — ${event.message}`, isError: true },
              ],
            }));
          } else if (event.type === "done") {
            setJob((j) => ({ ...j, cursor: j.total, pct: 100 }));
          }
          onEvent?.(event);
        });
      } catch (err) {
        setJob((j) => ({
          ...j,
          log: [...j.log, { at: stamp(), text: `Lỗi kết nối: ${(err as Error).message}`, isError: true }],
        }));
      } finally {
        setJob((j) => ({ ...j, running: false }));
      }
    },
    []
  );

  return { job, run };
}
