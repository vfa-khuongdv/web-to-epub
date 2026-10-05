import { useCallback, useEffect, useRef, useState } from "react";
import { fetchStory } from "../lib/api";
import { StoredStory } from "../types";
import { LiveCrawl } from "./useCrawlJob";

// One story's chapter list (no chapter text — that is loaded per chapter), refetched when
// its crawl ends. Only the newest request may land, so switching stories quickly never
// leaves the previous one on screen.
export function useStoryChapters(storyId: string | null, live: Record<string, LiveCrawl | undefined>) {
  const [story, setStory] = useState<StoredStory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async (id: string | null) => {
    const current = ++request.current;
    if (!id) {
      setStory(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const fresh = await fetchStory(id);
      if (request.current !== current) return;
      setStory(fresh);
      setError(null);
    } catch (err) {
      if (request.current !== current) return;
      setError((err as Error).message);
    } finally {
      if (request.current === current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(storyId);
  }, [storyId, load]);

  const crawling = storyId ? !!live[storyId] : false;
  const wasCrawling = useRef(crawling);
  useEffect(() => {
    if (wasCrawling.current && !crawling) void load(storyId);
    wasCrawling.current = crawling;
  }, [crawling, storyId, load]);

  const reload = useCallback(() => load(storyId), [load, storyId]);
  return { story: story && story.id === storyId ? story : null, loading, error, reload };
}
