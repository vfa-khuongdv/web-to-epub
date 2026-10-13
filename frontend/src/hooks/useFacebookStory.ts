import { useCallback, useEffect, useState } from "react";
import { fetchFacebookStory } from "../lib/api";
import { FacebookStoryState } from "../types";
import { FACEBOOK_CONNECTED } from "../components/settings/FacebookSettings";

/**
 * A story's Facebook Page state for the publish panel. Reloaded whenever the story's job
 * starts or ends (so a finished post shows up) and when the Page is connected or removed
 * in Settings while the panel is open. null = not loaded, or the request failed.
 */
export function useFacebookStory(storyId: string, jobRunning: boolean): FacebookStoryState | null {
  const [state, setState] = useState<FacebookStoryState | null>(null);
  const load = useCallback(() => {
    fetchFacebookStory(storyId)
      .then(setState)
      .catch(() => setState(null));
  }, [storyId]);

  useEffect(load, [load, jobRunning]);
  useEffect(() => {
    window.addEventListener(FACEBOOK_CONNECTED, load);
    return () => window.removeEventListener(FACEBOOK_CONNECTED, load);
  }, [load]);
  return state;
}
