import { useEffect } from "react";
import { LiveCrawl } from "../../hooks/useCrawlJob";
import { useStoryChapters } from "../../hooks/useStoryChapters";
import { ChapterData } from "./tree";

/**
 * Keeps one story's chapter list loaded (and refetched when its crawl ends) while its
 * folder is open, a tab of it is open, or it is the active folder. Draws nothing: the
 * list goes up to the shell, which builds the tree, the tabs and the panel from all of
 * them. One per story, so several folders can be open at once.
 */
export function StoryChaptersSource({
  storyId,
  live,
  onChange,
}: {
  storyId: string;
  live: Record<string, LiveCrawl | undefined>;
  onChange: (storyId: string, data: ChapterData | null) => void;
}) {
  const { story, loading, error, reload } = useStoryChapters(storyId, live);

  useEffect(() => {
    onChange(storyId, { story, loading, error, reload });
  }, [storyId, story, loading, error, reload, onChange]);

  useEffect(() => () => onChange(storyId, null), [storyId, onChange]);

  return null;
}
