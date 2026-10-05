import { useCallback, useEffect, useRef, useState } from "react";
import { fetchStories } from "../lib/api";
import { StorySummary } from "../types";
import { LiveCrawl } from "./useCrawlJob";

// The library as the disguise skins read it: the story list, refetched when a crawl
// leaves the live channel so its counts are not stale (what LibraryView does for its
// table). Read-only — adding, importing and deleting stay in the default view.
export function useStoryList(live: Record<string, LiveCrawl | undefined>) {
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setStories(await fetchStories());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const crawlingIds = Object.keys(live)
    .filter((id) => live[id])
    .sort()
    .join(",");
  const previous = useRef(crawlingIds);
  useEffect(() => {
    const before = previous.current.split(",").filter(Boolean);
    const after = crawlingIds.split(",").filter(Boolean);
    previous.current = crawlingIds;
    if (before.some((id) => !after.includes(id))) void reload();
  }, [crawlingIds, reload]);

  return { stories, loading, error, reload };
}
