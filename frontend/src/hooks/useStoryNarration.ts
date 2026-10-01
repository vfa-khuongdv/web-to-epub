import { useEffect, useMemo } from "react";
import { useLang } from "../i18n";
import { StoredStory } from "../types";
import { useVault } from "../vault";
import { PlayerQueue, readPosition, useNarrationPlayer } from "./narrationPlayer";
import { useNarration } from "./useNarration";

// Narration state and the app-wide player as one story page sees them: which chapters
// have audio, this story as the player's queue, and where listening can be resumed.
export function useStoryNarration(story: StoredStory, bookTitle: string, coverUrl: string | undefined) {
  const { t } = useLang();
  const vault = useVault();
  // Vietnamese books only, by the language saved on the story (not the unsaved field).
  const narratable = (story.language || "vi") === "vi";
  const narration = useNarration(story.id, narratable, story.updatedAt);
  const narratedCount = narration.state
    ? Object.values(narration.state.chapters).filter((s) => s === "ready").length
    : 0;
  // Chapters with current narration, in reading order: what the player can play.
  const narratedOrders = useMemo(
    () =>
      Object.entries(narration.state?.chapters ?? {})
        .filter(([, state]) => state === "ready")
        .map(([order]) => Number(order))
        .sort((a, b) => a - b),
    [narration.state]
  );
  const player = useNarrationPlayer();
  // This story as the player's queue; kept current while the page is open, so a chapter
  // narrated or edited meanwhile joins or leaves what is playing.
  const queue = useMemo<PlayerQueue>(
    () => ({
      storyId: story.id,
      storyTitle: bookTitle || story.title,
      orders: narratedOrders,
      titles: Object.fromEntries(story.chapters.map((c) => [c.order, c.title || t("Chapter {order}", { order: c.order })])),
      coverUrl,
    }),
    [story.id, story.title, story.chapters, bookTitle, narratedOrders, t, coverUrl]
  );
  const { updateQueue } = player;
  const narrationLoaded = narration.state !== null;
  useEffect(() => {
    // Not before this page knows which chapters have audio: an empty list would read as
    // "the chapter playing lost its audio" and stop the player on the way back to its story.
    if (narrationLoaded) updateQueue(queue);
  }, [narrationLoaded, queue, updateQueue]);
  const playChapter = (order: number) =>
    player.storyId === story.id && player.order === order ? player.toggle() : player.play(queue, order);
  // Where listening stopped last time, offered while this story is not the one loaded in
  // the player (re-read on every render, so it follows what the player just saved).
  const savedListen = player.storyId === story.id ? undefined : readPosition(story.id, vault.active);
  const resumeListen = savedListen && narratedOrders.includes(savedListen.order) ? savedListen : undefined;
  return { narratable, narration, narratedCount, narratedOrders, player, queue, playChapter, resumeListen };
}
