import { ComponentType } from "react";
import { CrawlJobState, LiveCrawl } from "../hooks/useCrawlJob";
import { DocumentHead, SkinId } from "../lib/ui/skin";

// What App hands a skin's shell: the live crawl state it already keeps, and the ways out
// to the parts of the app a skin does not redraw (settings, and the default view for
// adding stories, exporting, editing and narration).
export interface SkinAppContext {
  job: CrawlJobState;
  live: Record<string, LiveCrawl | undefined>;
  // Follow one story on the live channel (per-chapter progress and the crawl log). The
  // label shows in the crawl log — skins pass a neutral one, never the story title.
  attach: (label: string, storyId: string) => () => void;
  clearChapters: () => void;
  openSettings: () => void;
  // Show the default view, at a story (and a chapter's reader) when given. The skin stays
  // chosen: the default view offers the way back, and a reload returns to the skin.
  openInDefault: (target?: { storyId: string; order?: number }) => void;
  // Settings → Disguise → neutral names: skins show module-01 / part-0001 instead of titles.
  neutralNames: boolean;
  isPrivate: boolean;
  // Skins report what their tab should be called (the open file, the open sheet); the
  // stealth layer applies it, and replaces it with the decoy's while hidden.
  setHead: (head: DocumentHead | null) => void;
}

export interface SkinDefinition {
  id: SkinId;
  // i18n key for the settings switch.
  label: string;
  // The tab's title and icon until the shell reports its own.
  head: DocumentHead;
  // What the boss key shows: a full-screen fake of real work, with no story in it.
  decoy: { head: DocumentHead; Component: ComponentType };
  // The skin's whole app; absent for the default skin, which is the app itself.
  Shell?: ComponentType<{ app: SkinAppContext }>;
}
