import { useEffect, useRef, useState } from "react";
import { useLang } from "../../i18n";
import { deleteMusicTrack, fetchMusicTracks, uploadMusicTrack } from "../../lib/api";
import { RANGE_CLASS, playedStyle } from "../../lib/ui/range";
import { NarrationPlayer, useNarrationPlayer } from "../../hooks/narrationPlayer";
import { MusicTrack } from "../../types";
import { Icon } from "../ui/Icon";

// Same cap as the server (src/services/backgroundMusic.ts), checked before uploading.
const MAX_MUSIC_BYTES = 50 * 1024 * 1024;

/**
 * The background music the app plays under the voice: the tracks it ships with plus any
 * the user added, which one is playing (kept in this browser), and its own volume.
 *
 * Shown twice — in the player bar and in Settings — so it is mounted only where it is
 * wanted rather than fetched by anything that has no use for it.
 */
export default function MusicPicker({ player }: { player: NarrationPlayer }) {
  const { t } = useLang();
  const [tracks, setTracks] = useState<MusicTrack[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMusicTracks()
      .then(({ tracks: list }) => !cancelled && setTracks(list))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const add = async (file: File) => {
    setError(null);
    if (file.size > MAX_MUSIC_BYTES) {
      setError(t("The music file is too large (50 MB at most)"));
      return;
    }
    setBusy(true);
    try {
      const track = await uploadMusicTrack(file.name.replace(/\.[^.]+$/, "") || file.name, file);
      setTracks((list) => [...(list ?? []), track]);
      player.setMusicTrack(track.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await deleteMusicTrack(id);
      setTracks((list) => (list ?? []).filter((track) => track.id !== id));
      if (player.musicTrack === id) player.setMusicTrack(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Turning it on with nothing picked takes the first track, so the switch alone is
  // enough. Order matters: the track has to be set before the switch lets music start.
  const toggle = (enabled: boolean) => {
    if (enabled && !player.musicTrack && tracks?.length) {
      player.setMusicTrack(tracks[0].id);
    }
    player.setMusicEnabled(enabled);
  };

  return (
    <>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          className="size-4 accent-select"
          checked={player.musicEnabled}
          onChange={(event) => toggle(event.target.checked)}
        />
        <span>{t("Play background music while listening")}</span>
      </label>
      {!tracks ? (
        <p className="text-[12px] text-ink-3">{t("Loading music…")}</p>
      ) : (
        <ul
          role="radiogroup"
          aria-label={t("Background music")}
          className="max-h-72 overflow-y-auto rounded-tool border border-rule bg-content"
        >
          <li className="border-b border-rule">
            <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[13px]">
              <input
                type="radio"
                name="music-track"
                checked={player.musicTrack === null}
                onChange={() => player.setMusicTrack(null)}
              />
              <span>{t("None")}</span>
            </label>
          </li>
          {tracks.map((track) => (
            <li key={track.id} className="flex items-center gap-1 border-b border-rule px-1.5 last:border-b-0">
              <label
                className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1 py-0.5 text-[13px] ${
                  player.musicTrack === track.id ? "bg-select-soft" : "hover:bg-row-hover"
                }`}
              >
                <input
                  type="radio"
                  name="music-track"
                  checked={player.musicTrack === track.id}
                  onChange={() => player.setMusicTrack(track.id)}
                />
                <span className="min-w-0 flex-1 truncate">{track.name}</span>
              </label>
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                onClick={() => void remove(track.id)}
                aria-label={t("Remove {name}", { name: track.name })}
              >
                <Icon name="trash" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        <Icon name="volume" size={14} className="shrink-0 text-ink-3" />
        <input
          type="range"
          className={`${RANGE_CLASS} min-w-0 flex-1`}
          style={playedStyle(player.musicVolume, 1)}
          min={0}
          max={1}
          step={0.05}
          value={player.musicVolume}
          onChange={(event) => player.setMusicVolume(Number(event.target.value))}
          aria-label={t("Music volume")}
        />
        <button type="button" className="btn btn-tiny shrink-0" onClick={() => fileInput.current?.click()} disabled={busy}>
          <Icon name="upload" size={12} />
          {busy ? t("Uploading…") : t("Add music")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/flac,audio/ogg,.mp3,.m4a,.wav,.flac,.ogg"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void add(file);
          }}
        />
      </div>
      {error && (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      )}
      <p className="text-[11px] leading-snug text-ink-3">
        {t(
          "The music that comes with the app, plus your own files (MP3, M4A, WAV, FLAC or OGG). It loops under the voice while a chapter plays."
        )}
      </p>
    </>
  );
}

/** Settings → Background music: the same picker, reading the app-wide player. */
export function MusicSettings() {
  return <MusicPicker player={useNarrationPlayer()} />;
}
