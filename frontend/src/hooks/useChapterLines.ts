import { useEffect, useMemo, useRef, useState } from "react";
import { fetchChapterContent } from "../lib/api";
import { ChapterLine, chapterLines, withoutTitleHeading } from "../lib/skins/chapterLines";
import { useSkin } from "../skins/SkinProvider";

export interface ChapterText {
  title: string;
  lines: ChapterLine[];
}

// Chapters kept in memory, so flipping between open tabs or sheets does not refetch.
const CACHE_SIZE = 12;

// A chapter's text as lines for the disguise skins. `version` lets the caller drop the
// cached copy after a re-crawl rewrote it. With neutral names on, the chapter's title
// heading is left out (lib/skins/chapterLines.ts withoutTitleHeading).
export function useChapterLines(storyId: string | null, order: number | null, version = 0) {
  const neutral = useSkin().prefs.neutralNames;
  const cache = useRef(new Map<string, ChapterText>());
  const cacheKey = storyId !== null && order !== null ? `${storyId}:${order}:${version}` : null;
  const [state, setState] = useState<{ key: string | null; text: ChapterText | null; error: string | null }>({
    key: null,
    text: null,
    error: null,
  });

  useEffect(() => {
    if (!cacheKey || storyId === null || order === null) return;
    const hit = cache.current.get(cacheKey);
    if (hit) {
      setState({ key: cacheKey, text: hit, error: null });
      return;
    }
    let cancelled = false;
    fetchChapterContent(storyId, order).then(
      (chapter) => {
        const text = { title: chapter.title, lines: chapterLines(chapter.blocks ?? []) };
        cache.current.set(cacheKey, text);
        // Oldest out first: a Map iterates in insertion order.
        while (cache.current.size > CACHE_SIZE) cache.current.delete(cache.current.keys().next().value!);
        if (!cancelled) setState({ key: cacheKey, text, error: null });
      },
      (err: Error) => {
        if (!cancelled) setState({ key: cacheKey, text: null, error: err.message });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [cacheKey, storyId, order]);

  const current = state.key === cacheKey;
  const raw = current ? state.text : null;
  const text = useMemo(
    () => (raw && neutral ? { ...raw, lines: withoutTitleHeading(raw.lines) } : raw),
    [raw, neutral]
  );
  return {
    text,
    error: current ? state.error : null,
    loading: cacheKey !== null && !current,
  };
}
