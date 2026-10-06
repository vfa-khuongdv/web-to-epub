import { useEffect, useState } from "react";
import { fetchStoryAgentCrawler, rewriteStoryAgentCrawler, StoryAgentCrawler } from "../../lib/api";
import { useLang } from "../../i18n";
import { Icon } from "../ui/Icon";

/**
 * Shown in a story's details when its site is crawled by code the agent wrote. That code is reused for
 * every story of the site and never rewritten by itself; when the site changes and crawls start to
 * fail, this is where the person asks the agent for new code (the Agent log shows its steps).
 */
// `onRewritten` reloads the story's chapter list with the new code: rewriting alone leaves the list the old code made.
export default function AgentCrawlerPanel({ storyId, onRewritten }: { storyId: string; onRewritten?: () => Promise<void> }) {
  const { t } = useLang();
  const [info, setInfo] = useState<StoryAgentCrawler | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setInfo(null);
    setOutcome(null);
    fetchStoryAgentCrawler(storyId).then(setInfo, () => setInfo(null));
  }, [storyId]);

  if (!info?.available) return null;

  async function rewrite() {
    setBusy(true);
    setOutcome(null);
    try {
      await rewriteStoryAgentCrawler(storyId);
      await onRewritten?.();
      setOutcome({ ok: true, text: t("The crawler was rewritten and the chapter list updated. Crawl the new chapters or retry the failed ones.") });
    } catch (err) {
      setOutcome({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <span className="label">{t("Agent crawler")}</span>
      <p className="text-[12px] leading-snug text-ink-3">
        {t(
          "This site is crawled with code the agent wrote once and the app reuses. If chapters are missing, wrong or failing, ask the agent to write it again."
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-tiny self-start" disabled={busy || !info.ready} onClick={() => void rewrite()}>
          <Icon name="sparkles" size={13} />
          {busy ? t("Rewriting…") : t("Rewrite the crawler with the agent")}
        </button>
        {!info.ready && <span className="text-[12px] text-ink-3">{t("Turn the agent crawler on in Settings first.")}</span>}
      </div>
      {outcome && (
        <p role="status" className={`text-[12px] leading-snug ${outcome.ok ? "text-ink-2" : "text-error"}`}>
          {outcome.text}
        </p>
      )}
    </div>
  );
}
