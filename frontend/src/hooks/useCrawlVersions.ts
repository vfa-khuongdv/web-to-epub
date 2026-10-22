import { useEffect, useRef, useState } from "react";
import { LiveCrawl } from "./useCrawlJob";

// A number per story that goes up each time a crawl of it ends, for useChapterLines'
// `version`: a re-crawl may have rewritten a chapter that is cached or on screen.
export function useCrawlVersions(live: Record<string, LiveCrawl | undefined>): Record<string, number> {
  const [versions, setVersions] = useState<Record<string, number>>({});
  const crawling = Object.keys(live)
    .filter((id) => live[id])
    .sort()
    .join(",");
  const previous = useRef(crawling);
  useEffect(() => {
    const ended = endedCrawls(previous.current, crawling);
    previous.current = crawling;
    if (ended.length === 0) return;
    setVersions((current) => {
      const next = { ...current };
      for (const id of ended) next[id] = (next[id] ?? 0) + 1;
      return next;
    });
  }, [crawling]);
  return versions;
}

// Story ids whose crawl ended between two snapshots of the live channel (comma lists).
export function endedCrawls(before: string, after: string): string[] {
  const still = new Set(after.split(",").filter(Boolean));
  return before.split(",").filter((id) => id && !still.has(id));
}
