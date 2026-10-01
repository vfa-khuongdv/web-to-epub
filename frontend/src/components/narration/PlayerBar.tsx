import { useEffect, useRef, useState } from "react";
import { useLang } from "../../i18n";
import { RANGE_CLASS, playedStyle } from "../../lib/ui/range";
import { NarrationPlayer, PLAYBACK_RATES, SKIP_S } from "../../hooks/narrationPlayer";
import { vaultQuery } from "../../vault/token";
import { Icon } from "../ui/Icon";
import MusicPicker from "./MusicPicker";

// m:ss, or h:mm:ss for the rare chapter past an hour.
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function Cover({ src }: { src: string | undefined }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    <img
      src={src}
      alt=""
      className="h-11 w-11 shrink-0 rounded-[2px] border border-rule-2 bg-sunken object-cover"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-rule-2 bg-sunken text-ink-3">
      <Icon name="book" size={16} />
    </span>
  );
}

/**
 * The music button in the bar. The picker it opens is the same one Settings shows, so the
 * tracks it lists are whatever the app ships with plus what the user added.
 */
function BackgroundMusicMenu({ player }: { player: NarrationPlayer }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <span className="relative flex items-center">
      <button
        type="button"
        className={`btn btn-quiet btn-tiny ${player.musicTrack ? "text-select" : ""}`}
        aria-expanded={open}
        aria-controls="player-music"
        title={t("Background music")}
        aria-label={t("Background music")}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="music" size={14} />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-20 cursor-default"
            aria-label={t("Close")}
            onClick={() => setOpen(false)}
          />
          <div
            id="player-music"
            className="absolute bottom-full right-0 z-30 mb-1.5 w-72 rounded-tool border border-rule-2 bg-raised p-1.5 shadow-lg"
          >
            <h3 className="px-1.5 pb-1 pt-0.5 text-[10.5px] font-[650] uppercase tracking-[0.07em] text-ink-2">
              {t("Background music")}
            </h3>
            <MusicPicker player={player} />
          </div>
        </>
      )}
    </span>
  );
}

/**
 * Controls for the app's narration player: along the bottom of the app, and inside the
 * reader (which covers it). Three zones like a player bar: what is playing (cover,
 * chapter, story), the transport with the seek bar, and speed/volume/queue/close.
 * Renders nothing while no chapter is loaded.
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
  const [queueOpen, setQueueOpen] = useState(false);

  // The queue popover closes on Escape; clicking outside is handled by its backdrop.
  useEffect(() => {
    if (!queueOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQueueOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [queueOpen]);

  if (player.order === null || player.storyId === null) return null;
  const order = player.order;
  const storyId = player.storyId;
  const chapterTitle = player.titleOf(order) || t("Chapter {order}", { order });
  const coverSrc =
    player.coverUrl &&
    (player.coverUrl.startsWith("http")
      ? player.coverUrl
      : // An <img> cannot send headers, so a private cover carries the token in the
        // query string the same way the story page does.
        `/api/stories/${encodeURIComponent(storyId)}/cover?v=${encodeURIComponent(player.coverUrl)}${vaultQuery()}`);

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule-2 bg-raised px-3.5 py-2"
      role="region"
      aria-label={t("Narration player")}
    >
      {/* What is playing. */}
      <div className="flex min-w-0 grow basis-56 items-center gap-2.5">
        <Cover key={storyId} src={coverSrc || undefined} />
        <div className="flex min-w-0 flex-col">
          {onShowChapter ? (
            <button
              type="button"
              className="truncate text-left text-[13px] font-semibold hover:underline"
              onClick={() => onShowChapter(storyId, order)}
              title={t("Read this chapter")}
            >
              {chapterTitle}
            </button>
          ) : (
            <span className="truncate text-[13px] font-semibold">{chapterTitle}</span>
          )}
          {player.storyTitle && <span className="truncate text-xs text-ink-3">{player.storyTitle}</span>}
        </div>
      </div>

      {/* Transport, then the seek bar with the elapsed and total time. */}
      <div className="flex min-w-0 grow-[1.6] basis-72 flex-col gap-1">
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            className="btn btn-quiet flex h-8 w-8 items-center justify-center p-0"
            onClick={player.previous}
            disabled={!player.hasPrevious}
            aria-label={t("Previous chapter")}
          >
            <Icon name="chevron" size={16} className="rotate-180" />
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
            className="btn btn-primary flex h-9 w-9 items-center justify-center p-0"
            onClick={player.toggle}
            aria-label={player.playing ? t("Pause") : t("Play")}
          >
            <Icon name={player.playing ? "pause" : "play"} size={16} />
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
            className="btn btn-quiet flex h-8 w-8 items-center justify-center p-0"
            onClick={player.next}
            disabled={!player.hasNext}
            aria-label={t("Next chapter")}
          >
            <Icon name="chevron" size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-[11px] tabular-nums text-ink-3">
          <span>{formatClock(player.time)}</span>
          <input
            type="range"
            className={`${RANGE_CLASS} min-w-0 flex-1`}
            style={playedStyle(player.time, player.duration)}
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

      {/* Speed, volume, the queue, and a way to stop. */}
      <div className="flex min-w-0 grow basis-56 items-center justify-end gap-2">
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
        <span className="hidden items-center gap-1.5 min-[700px]:flex">
          <Icon name="volume" size={14} className="text-ink-3" />
          <input
            type="range"
            className={`${RANGE_CLASS} w-20`}
            style={playedStyle(player.volume, 1)}
            min={0}
            max={1}
            step={0.05}
            value={player.volume}
            onChange={(event) => player.setVolume(Number(event.target.value))}
            aria-label={t("Volume")}
          />
        </span>
        <BackgroundMusicMenu player={player} />
        <span className="relative flex items-center">
          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            aria-expanded={queueOpen}
            aria-controls="player-queue"
            title={t("Next up")}
            aria-label={t("Playback queue")}
            onClick={() => setQueueOpen((open) => !open)}
          >
            <Icon name="queue" size={14} />
          </button>
          {queueOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-20 cursor-default"
                aria-label={t("Close")}
                onClick={() => setQueueOpen(false)}
              />
              <div
                id="player-queue"
                className="absolute bottom-full right-0 z-30 mb-1.5 max-h-72 w-72 overflow-auto rounded-tool border border-rule-2 bg-raised p-1.5 shadow-lg"
              >
                <h3 className="px-1.5 pb-1 pt-0.5 text-[10.5px] font-[650] uppercase tracking-[0.07em] text-ink-2">
                  {t("Next up")}
                </h3>
                <ul>
                  {player.upNext.map((o) => (
                    <li key={o}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 rounded-[2px] px-1.5 py-1 text-left ${
                          o === order ? "bg-select-soft text-select" : "hover:bg-row-hover"
                        }`}
                        onClick={() => {
                          player.jumpTo(o);
                          setQueueOpen(false);
                        }}
                      >
                        <span className="w-7 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-3">
                          {o}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">
                          {player.titleOf(o) || t("Chapter {order}", { order: o })}
                        </span>
                        {o === order && <Icon name="play" size={11} className="shrink-0" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </span>
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
