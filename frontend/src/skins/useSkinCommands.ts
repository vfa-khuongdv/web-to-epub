import { useMemo, useState } from "react";
import { useNarrationPlayer } from "../hooks/narrationPlayer";
import { useLang } from "../i18n";
import { startStoryCrawl, stopStoryCrawl } from "../lib/api";
import { SKIN_IDS } from "../lib/ui/skin";
import { requestStealthToggle } from "../lib/ui/stealth";
import { PaletteCommand } from "./CommandPalette";
import { SKINS } from "./registry";
import { useSkin } from "./SkinProvider";
import { SkinAppContext } from "./types";

/**
 * The commands every skin's palette offers, with the story (and chapter) the skin has
 * open: back to the default view there, settings, switching skin (search-only), crawling
 * the story, the narration, and the boss key. A shell adds its own (next chapter, a panel) in front.
 * Crawl errors come back as `crawlError`, for the shell to show in its own way.
 */
export function useSkinCommands(app: SkinAppContext, current: { storyId: string | null; order: number | null }) {
  const { t } = useLang();
  const { skin, setSkin } = useSkin();
  const player = useNarrationPlayer();
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const { storyId, order } = current;
  const crawling = storyId ? !!app.live[storyId] : false;

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [];
    list.push({
      id: "open-default",
      label: t("Open in the normal view"),
      run: () => app.openInDefault(storyId ? { storyId, order: order ?? undefined } : undefined),
    });
    if (storyId && !crawling) {
      list.push({
        id: "crawl",
        label: t("Download the rest"),
        run: () => {
          setCrawlError(null);
          startStoryCrawl(storyId).catch((err: Error) => setCrawlError(err.message));
        },
      });
    }
    if (storyId && crawling) {
      list.push({
        id: "stop-crawl",
        label: t("Stop downloading"),
        run: () => {
          setCrawlError(null);
          stopStoryCrawl(storyId).catch((err: Error) => setCrawlError(err.message));
        },
      });
    }
    if (player.order !== null) {
      list.push({
        id: "narration",
        label: player.playing ? t("Pause audio") : t("Play audio"),
        run: player.toggle,
      });
    }
    list.push({ id: "hide", label: t("Hide now"), hint: "`", run: requestStealthToggle });
    // Found by typing ("look", "spreadsheet"), never listed on the open palette: a list of
    // other programs to turn into would give the disguise away at a glance.
    for (const id of SKIN_IDS) {
      if (id === skin) continue;
      list.push({
        id: `skin-${id}`,
        label: t("Switch look: {skin}", { skin: t(SKINS[id].label) }),
        searchOnly: true,
        run: () => setSkin(id),
      });
    }
    list.push({ id: "settings", label: t("Settings"), run: app.openSettings });
    return list;
  }, [app, storyId, order, crawling, player.order, player.playing, player.toggle, skin, setSkin, t]);

  return { commands, crawlError, clearCrawlError: () => setCrawlError(null) };
}
