// The Actions tab: the open story's download as a workflow run. Pure parts — whether
// there is a run and how it ended, and the step log with every story address rewritten
// (code/terminal.ts logText: a story URL is never printed).

import { CrawlJobState, CrawlLogLine, LiveCrawl } from "../../hooks/useCrawlJob";
import { logText } from "../../lib/skins/crawlLog";
import { hashString } from "../../lib/skins/hash";

export type RunStatus = "running" | "success" | "failure";

export interface RunSummary {
  status: RunStatus;
  done: number;
  total: number;
  errors: number;
}

/**
 * The run of the open repository: the live crawl while one runs, else what this session
 * saw of the last one (its log or its counts), else none. `job` is the attached story's
 * (RepoShell attaches whichever repository is open).
 */
export function currentRun(
  live: LiveCrawl | undefined,
  job: Pick<CrawlJobState, "cursor" | "total" | "errors" | "log">
): RunSummary | null {
  if (live) {
    return { status: "running", done: live.cursor, total: live.total, errors: Math.max(live.errors, job.errors) };
  }
  if (job.log.length === 0 && job.total === 0) return null;
  return { status: job.errors > 0 ? "failure" : "success", done: job.cursor, total: job.total, errors: job.errors };
}

// The run's number on the list: stable per repository, like a counter that has been
// going for a while.
export function runNumber(storyId: string): number {
  return 12 + (hashString(storyId) % 180);
}

export interface LogRow {
  number: number;
  at: string;
  text: string;
  error: boolean;
}

export function logRows(log: CrawlLogLine[], fileForUrl: (url: string) => string | null): LogRow[] {
  return log.map((line, index) => ({
    number: index + 1,
    at: line.at,
    text: logText(line.text, fileForUrl),
    error: line.isError,
  }));
}
