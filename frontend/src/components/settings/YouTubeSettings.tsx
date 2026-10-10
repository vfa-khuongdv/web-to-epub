import { useEffect, useRef, useState } from "react";
import { connectYouTube, disconnectYouTube, fetchMusicTracks, fetchYouTubeStatus, saveYouTubeSettings } from "../../lib/api";
import { useLang } from "../../i18n";
import { MusicTrack, YouTubeStatus } from "../../types";
import { Icon } from "../ui/Icon";

/**
 * Settings → YouTube: the user's own Google OAuth client, the sign-in, and the defaults
 * every video is made and uploaded with. The client secret stays in the file the user
 * saved; the app only stores its path and the tokens in its own data dir.
 */
// The story panel listens for this to reload once the sign-in lands.
export const YOUTUBE_CONNECTED = "youtube-connected";
const CONNECT_WAIT_MS = 2 * 60_000;
const CONNECT_POLL_MS = 2000;

export default function YouTubeSettings({ onSaved, onError }: { onSaved: () => void; onError: (m: string) => void }) {
  const { t } = useLang();
  const [status, setStatus] = useState<YouTubeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [secretPath, setSecretPath] = useState("");
  const [channel, setChannel] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [genreTags, setGenreTags] = useState("");
  const [ffmpegPath, setFfmpegPath] = useState("");
  const [syntheticMedia, setSyntheticMedia] = useState(true);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [musicId, setMusicId] = useState("");
  const [musicVolume, setMusicVolume] = useState(0.15);
  // Set while the browser sign-in is pending; the page polls until the server has the account.
  const [waiting, setWaiting] = useState(false);
  const alive = useRef(true);

  async function load() {
    try {
      const next = await fetchYouTubeStatus();
      setStatus(next);
      setSecretPath(next.clientSecretPath);
      setChannel(next.config.channel);
      setScheduleTime(next.config.scheduleTime);
      setGenreTags(next.config.genreTags);
      setFfmpegPath(next.config.ffmpegPath);
      setSyntheticMedia(next.config.syntheticMedia);
      setMusicId(next.config.musicId ?? "");
      setMusicVolume(next.config.musicVolume);
    } catch (err) {
      setFailed(true);
      onError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
    fetchMusicTracks()
      .then(({ tracks }) => setTracks(tracks))
      .catch(() => setTracks([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  async function save(patch: Parameters<typeof saveYouTubeSettings>[0]) {
    setBusy(true);
    try {
      await saveYouTubeSettings(patch);
      await load();
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The browser tab signs in on its own; the app has to notice by itself. Poll until the
  // server reports the account, then reload and tell the story panel.
  async function waitForConnection() {
    const deadline = Date.now() + CONNECT_WAIT_MS;
    setWaiting(true);
    while (alive.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, CONNECT_POLL_MS));
      if (!alive.current) return;
      try {
        const next = await fetchYouTubeStatus();
        if (next.connected) {
          setWaiting(false);
          await load();
          window.dispatchEvent(new Event(YOUTUBE_CONNECTED));
          onSaved();
          return;
        }
      } catch {
        // A failed poll is not the sign-in's answer; keep waiting.
      }
    }
    setWaiting(false);
  }

  async function connect() {
    setBusy(true);
    setConnectUrl(null);
    try {
      const { url } = await connectYouTube(secretPath);
      setConnectUrl(url);
      window.open(url, "_blank", "noopener");
      void waitForConnection();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(t("Sign out of YouTube on this computer?"))) return;
    setBusy(true);
    try {
      await disconnectYouTube();
      await load();
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return <p className="text-[12px] text-ink-3">{failed ? t("Could not load the YouTube settings") : t("Loading…")}</p>;
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px]">
            {status.connected ? t("Connected: {channel}", { channel: status.channel ?? "" }) : t("Not connected to YouTube yet.")}
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            {t(
              "Sign in with your own Google account to publish. Create a Desktop-app OAuth client in Google Cloud (enable YouTube Data API v3, add yourself as a test user), save its JSON, and point the path below at it."
            )}
          </p>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {status.connected ? (
            <button type="button" className="btn btn-tiny" disabled={busy} onClick={() => void disconnect()}>
              {t("Sign out")}
            </button>
          ) : (
            <button type="button" className="btn btn-tiny" disabled={busy || !secretPath.trim()} onClick={() => void connect()}>
              <Icon name="youtube" size={13} />
              {t("Connect YouTube")}
            </button>
          )}
        </div>
      </div>

      {connectUrl && !status.connected && (
        <p className="text-[12px] leading-snug text-ink-3">
          {t("If the browser did not open, use this link:")}{" "}
          <a className="underline" href={connectUrl} target="_blank" rel="noreferrer">
            {connectUrl.slice(0, 60)}…
          </a>
        </p>
      )}
      {waiting && (
        <p role="status" className="text-[12px] leading-snug text-ink-2">
          {t("Waiting for the Google sign-in in your browser…")}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px]">{t("OAuth client JSON")}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            {status.hasClientSecret ? t("File found.") : t("File not found at this path.")}
          </p>
        </div>
        <input
          className="input w-72 max-w-full"
          aria-label={t("OAuth client JSON")}
          value={secretPath}
          disabled={busy}
          onChange={(event) => setSecretPath(event.target.value)}
          onBlur={() => secretPath.trim() && secretPath !== status.clientSecretPath && void save({ clientSecretPath: secretPath.trim() })}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px]">{t("Channel name in titles")}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            {t("Used in video titles, the playlist name and the subscribe line.")}
          </p>
        </div>
        <input
          className="input w-56"
          aria-label={t("Channel name in titles")}
          value={channel}
          maxLength={80}
          disabled={busy}
          onChange={(event) => setChannel(event.target.value)}
          onBlur={() => channel.trim() && channel !== status.config.channel && void save({ channel: channel.trim() })}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px]">{t("Daily publish time")}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{t("The \"updates every evening\" line and the default schedule time.")}</p>
        </div>
        <input
          className="input w-28"
          aria-label={t("Daily publish time")}
          value={scheduleTime}
          maxLength={10}
          disabled={busy}
          onChange={(event) => setScheduleTime(event.target.value)}
          onBlur={() => scheduleTime.trim() && scheduleTime !== status.config.scheduleTime && void save({ scheduleTime: scheduleTime.trim() })}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px]">{t("Genre tags")}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{t("Extra tags added to every chapter, comma separated.")}</p>
        </div>
        <input
          className="input w-72 max-w-full"
          aria-label={t("Genre tags")}
          value={genreTags}
          maxLength={200}
          disabled={busy}
          onChange={(event) => setGenreTags(event.target.value)}
          onBlur={() => genreTags !== status.config.genreTags && void save({ genreTags })}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px]">{t("ffmpeg path")}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            {status.ffmpeg ? t("Found: {path}", { path: status.ffmpeg }) : t("Not found — install ffmpeg to make videos.")}
          </p>
        </div>
        <input
          className="input w-72 max-w-full"
          aria-label={t("ffmpeg path")}
          placeholder={t("Empty = find automatically")}
          value={ffmpegPath}
          disabled={busy}
          onChange={(event) => setFfmpegPath(event.target.value)}
          onBlur={() => ffmpegPath !== status.config.ffmpegPath && void save({ ffmpegPath })}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px]">{t("Default background music")}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            {t("Used for new chapters unless you pick another track in the panel.")}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <select
            className="input w-44"
            aria-label={t("Default background music")}
            value={musicId}
            disabled={busy}
            onChange={(event) => {
              setMusicId(event.target.value);
              void save({ musicId: event.target.value });
            }}
          >
            <option value="">{t("No music")}</option>
            {tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </select>
          <input
            type="range"
            className="w-24"
            min={0}
            max={1}
            step={0.05}
            aria-label={t("Music volume")}
            value={musicVolume}
            disabled={busy}
            onChange={(event) => setMusicVolume(Number(event.target.value))}
            onBlur={() => musicVolume !== status.config.musicVolume && void save({ musicVolume })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px]">{t("Disclose AI narration")}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            {t("Marks every upload as containing synthetic media (YouTube's disclosure for AI voices).")}
          </p>
        </div>
        <input
          type="checkbox"
          className="size-4 accent-select"
          aria-label={t("Disclose AI narration")}
          checked={syntheticMedia}
          disabled={busy}
          onChange={(event) => void save({ syntheticMedia: event.target.checked })}
        />
      </div>

      <p className="text-[11px] leading-snug text-ink-3">
        {t(
          "Uploads always start private; a scheduled video becomes public at its time. The API allows about 6 uploads a day, and a project that has not passed YouTube's audit may keep videos private. Only upload stories you have the right to publish."
        )}
      </p>
    </>
  );
}
