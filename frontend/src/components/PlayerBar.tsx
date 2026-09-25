import { useLang } from "../i18n";
import { NarrationPlayer, PLAYBACK_RATES } from "../hooks/narrationPlayer";
import { Icon } from "./Icon";

// m:ss, or h:mm:ss for the rare chapter past an hour.
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const SKIP_S = 15;

/**
 * Controls for the app's narration player: along the bottom of the app, and inside the
 * reader (which covers it). Names the story too — it keeps playing while the reader
 * browses to another one. Renders nothing while no chapter is loaded.
 */
export default function PlayerBar({
  player,
  onShowChapter,
}: {
  player: NarrationPlayer;
  // Opens the chapter being played in its story's reader (the app-wide bar only).
  onShowChapter?: (storyId: string, order: number) => void;
}) {
  const { t } = useLang();
  if (player.order === null || player.storyId === null) return null;
  const order = player.order;
  const storyId = player.storyId;
  const chapterTitle = player.titleOf(order) || t("Chapter {order}", { order });

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-rule-2 bg-raised px-3.5 py-2"
      role="region"
      aria-label={t("Narration player")}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-quiet btn-tiny"
          onClick={player.previous}
          disabled={!player.hasPrevious}
          aria-label={t("Previous chapter")}
        >
          <Icon name="chevron" size={13} className="rotate-180" />
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-tiny"
          onClick={() => player.skip(-SKIP_S)}
          aria-label={t("Back {seconds} seconds", { seconds: SKIP_S })}
        >
          −{SKIP_S}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-tiny"
          onClick={player.toggle}
          aria-label={player.playing ? t("Pause") : t("Play")}
        >
          <Icon name={player.playing ? "pause" : "play"} size={12} />
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-tiny"
          onClick={() => player.skip(SKIP_S)}
          aria-label={t("Forward {seconds} seconds", { seconds: SKIP_S })}
        >
          +{SKIP_S}
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-tiny"
          onClick={player.next}
          disabled={!player.hasNext}
          aria-label={t("Next chapter")}
        >
          <Icon name="chevron" size={13} />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5 text-[12.5px]">
          {onShowChapter ? (
            <button
              type="button"
              className="truncate text-left font-semibold hover:underline"
              onClick={() => onShowChapter(storyId, order)}
              title={t("Read this chapter")}
            >
              {chapterTitle}
            </button>
          ) : (
            <span className="truncate font-semibold">{chapterTitle}</span>
          )}
          {player.storyTitle && <span className="truncate text-ink-3">· {player.storyTitle}</span>}
        </span>
        <div className="flex items-center gap-2 text-[11px] tabular-nums text-ink-3">
          <span>{formatClock(player.time)}</span>
          <input
            type="range"
            className="min-w-0 flex-1 accent-select"
            min={0}
            max={player.duration || 0}
            step={1}
            value={Math.min(player.time, player.duration || 0)}
            disabled={!player.duration}
            onChange={(event) => player.seek(Number(event.target.value))}
            aria-label={t("Position")}
          />
          <span>{formatClock(player.duration)}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <select
          className="input h-7 w-[4.5rem] py-0 text-xs"
          value={player.rate}
          onChange={(event) => player.setRate(Number(event.target.value))}
          aria-label={t("Playback speed")}
        >
          {PLAYBACK_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-quiet btn-tiny" onClick={player.close} aria-label={t("Close player")}>
          <Icon name="x" size={12} />
        </button>
      </div>

      {player.error && (
        <p className="basis-full text-xs text-error" role="alert">
          {t("Could not play this chapter's audio.")}
        </p>
      )}
    </div>
  );
}
