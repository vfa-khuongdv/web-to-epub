import { useLang } from "../i18n";
import { NarrationPlayer } from "../hooks/narrationPlayer";
import { Icon } from "./Icon";
import { formatClock } from "./PlayerBar";

/**
 * The reader's player: small, beside its Listen button, so the page keeps the whole
 * window. Play/pause, where it is, and a way to stop — the rest lives in the app's bar.
 * Shows the chapter number when the voice is on a chapter other than the one open.
 */
export default function MiniPlayer({ player, showChapter }: { player: NarrationPlayer; showChapter: boolean }) {
  const { t } = useLang();
  if (player.order === null) return null;

  return (
    <div
      className="flex items-center gap-1.5 rounded-tool border border-rule-2 bg-raised py-0.5 pl-0.5 pr-1.5 text-[11px] tabular-nums text-ink-2"
      role="region"
      aria-label={t("Narration player")}
    >
      <button
        type="button"
        className="btn btn-quiet btn-tiny"
        onClick={player.toggle}
        aria-label={player.playing ? t("Pause") : t("Play")}
      >
        <Icon name={player.playing ? "pause" : "play"} size={12} />
      </button>
      {showChapter && (
        <span className="font-semibold text-ink">{t("Ch. {order}", { order: player.order })}</span>
      )}
      <input
        type="range"
        className="w-24 accent-select"
        min={0}
        max={player.duration || 0}
        step={1}
        value={Math.min(player.time, player.duration || 0)}
        disabled={!player.duration}
        onChange={(event) => player.seek(Number(event.target.value))}
        aria-label={t("Position")}
      />
      <span>
        {formatClock(player.time)} / {formatClock(player.duration)}
      </span>
      <button type="button" className="btn btn-quiet btn-tiny" onClick={player.close} aria-label={t("Close player")}>
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}
