import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteYouTubeChapter,
  fetchMusicTracks,
  prepareYouTube,
  renderYouTube,
  saveYouTubeChapter,
  deleteYouTubeCompilation,
  planYouTubeCompilation,
  renderYouTubeCompilation,
  saveYouTubeCredits,
  stopYouTube,
  syncYouTube,
  uploadYouTube,
  uploadYouTubeCompilation,
  youTubeCompilationVideoUrl,
  youTubeVideoUrl,
} from "../../lib/api";
import { distributeSchedule, formatPublishAt, isoFromLocalInput, localInputValue, tomorrowLocalDate } from "../../lib/format/schedule";
import { formatEta } from "../../lib/format/formatEta";
import { useLang } from "../../i18n";
import { MusicTrack, StoredStory, YouTubeChapterState, YouTubeCompilationPlan, YouTubeVideoRecord } from "../../types";
import { useYouTube } from "../../hooks/useYouTube";
import { YOUTUBE_CONNECTED } from "../settings/YouTubeSettings";
import { Icon } from "../ui/Icon";
import { ProgressBar } from "../ui/ProgressBar";
import { ChipState, StatusChip } from "../ui/StatusChip";

/**
 * The YouTube panel: one story, from "what will be uploaded" to videos on the channel.
 *
 * Three separate, person-driven steps — fill the upload info (the agent writes the
 * summaries), make the MP4s, upload. Nothing here creates a playlist or uploads a video
 * until the person confirms it in the dialog; uploads always go out private, optionally
 * scheduled public.
 */
export default function YouTubePanel({
  story,
  onClose,
  onOpenSettings,
  playerMusic,
}: {
  story: StoredStory;
  onClose: () => void;
  onOpenSettings: () => void;
  // The player's background music, used as the default when Settings → YouTube has none.
  playerMusic?: { track: string | null; enabled: boolean };
}) {
  const { lang, t } = useLang();
  const { state, outcome, error, refresh, dismissOutcome } = useYouTube(story.id, true);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [author, setAuthor] = useState("");
  const [translator, setTranslator] = useState("");
  const [genreTags, setGenreTags] = useState("");
  const [musicId, setMusicId] = useState("");
  const [musicVolume, setMusicVolume] = useState(0.15);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [musicDefaultApplied, setMusicDefaultApplied] = useState(false);
  const [startDate, setStartDate] = useState(tomorrowLocalDate());
  const [startTime, setStartTime] = useState("18:00");
  const [perDay, setPerDay] = useState(10);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createPlaylist, setCreatePlaylist] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const synced = useRef(false);
  // Full-story video (compilation): the plan is fetched from the server so the panel and
  // the renderer agree on the split.
  const [compilationIntro, setCompilationIntro] = useState("");
  const [compilationLabelWord, setCompilationLabelWord] = useState("Trọn bộ");
  const [compilationPlan, setCompilationPlan] = useState<YouTubeCompilationPlan | null>(null);
  const [compilationUploadOpen, setCompilationUploadOpen] = useState(false);
  const [compilationCreatePlaylist, setCompilationCreatePlaylist] = useState(false);
  const [compilationNeedsPlaylist, setCompilationNeedsPlaylist] = useState(false);
  const [compilationDialogError, setCompilationDialogError] = useState<string | null>(null);

  useEffect(() => {
    fetchMusicTracks()
      .then(({ tracks, defaultId }) => {
        setTracks(tracks);
        setDefaultId(defaultId);
      })
      .catch(() => setTracks([]));
  }, []);

  // The person may connect YouTube from Settings while this panel is open.
  useEffect(() => {
    const onConnected = () => void refresh();
    window.addEventListener(YOUTUBE_CONNECTED, onConnected);
    return () => window.removeEventListener(YOUTUBE_CONNECTED, onConnected);
  }, [refresh]);

  // First load only: fields start from the story's saved values, and every chapter that
  // still has work left is selected.
  useEffect(() => {
    if (!state || initialized) return;
    setInitialized(true);
    setAuthor(state.credits.author ?? "");
    setTranslator(state.credits.translator ?? "");
    setGenreTags(state.credits.genreTags);
    setMusicVolume(state.config.musicVolume);
    setStartTime(state.config.scheduleTime || "18:00");
    setSelected(
      new Set(
        state.chapters
          .filter(
            (chapter) =>
              chapter.hasAudio && (!chapter.record || chapter.record.status === "draft" || chapter.record.status === "error")
          )
          .map((chapter) => chapter.order)
      )
    );
  }, [state, initialized]);

  // Default music: the Settings → YouTube track first, else the player's background
  // music (the bundled default until the person picks one).
  useEffect(() => {
    if (!state || musicDefaultApplied) return;
    if (state.config.musicId) {
      setMusicId(state.config.musicId);
      setMusicDefaultApplied(true);
      return;
    }
    if (!playerMusic?.enabled) {
      setMusicDefaultApplied(true);
      return;
    }
    const track = playerMusic.track ?? defaultId;
    if (!track) return; // the track list has not loaded yet
    setMusicId(track);
    setMusicDefaultApplied(true);
  }, [state, playerMusic?.enabled, playerMusic?.track, defaultId, musicDefaultApplied]);

  // A finished job clears whatever the last action left on screen.
  useEffect(() => {
    if (outcome) setMessage(null);
  }, [outcome]);

  // Videos uploaded by the upload script (or another machine) are not in this library:
  // ask YouTube once per open so they show as uploaded instead of waiting to be re-uploaded.
  useEffect(() => {
    if (!state?.connected || synced.current) return;
    synced.current = true;
    void syncFromYouTube(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.connected]);

  const byOrder = useMemo(() => new Map((state?.chapters ?? []).map((chapter) => [chapter.order, chapter])), [state]);
  const running = state?.running ?? null;
  const selectedOrders = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  const renderOrders = selectedOrders.filter((order) => {
    const record = byOrder.get(order)?.record;
    return record && !record.videoId && record.status !== "uploaded";
  });
  const uploadOrders = selectedOrders.filter((order) => {
    const record = byOrder.get(order)?.record;
    return record && (record.status === "rendered" || record.status === "error");
  });
  const uploadedCount = (state?.chapters ?? []).filter((chapter) => chapter.record?.status === "uploaded").length;
  const playlistMissing = state ? !state.playlist.exists : false;

  function toggle(order: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(order)) next.delete(order);
      else next.add(order);
      return next;
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function fillInfo() {
    if (!state || selectedOrders.length === 0) return;
    const replacing = selectedOrders.filter((order) => byOrder.get(order)?.record);
    if (
      replacing.length > 0 &&
      !window.confirm(t("Replace the upload info of {count} chapters that already have drafts?", { count: replacing.length }))
    ) {
      return;
    }
    void run(async () => {
      const publishAt = distributeSchedule(selectedOrders, startDate, startTime, perDay);
      await prepareYouTube(story.id, {
        orders: selectedOrders,
        musicId,
        musicVolume,
        publishAt,
        author,
        translator,
        genreTags,
      });
    });
  }

  function applySchedule() {
    if (selectedOrders.length === 0) return;
    void run(async () => {
      const publishAt = distributeSchedule(selectedOrders, startDate, startTime, perDay);
      for (const order of selectedOrders) {
        const record = byOrder.get(order)?.record;
        if (!record) continue;
        await saveYouTubeChapter(story.id, order, { publishAt: publishAt[order] ?? null });
      }
      await refresh();
      setMessage(t("Schedule applied to {count} chapters.", { count: selectedOrders.length }));
    });
  }

  function makeVideos() {
    if (renderOrders.length === 0) return;
    if (
      !window.confirm(
        t("Make {count} videos on this computer? This can take a few minutes per chapter.", { count: renderOrders.length })
      )
    ) {
      return;
    }
    void run(async () => {
      await renderYouTube(story.id, renderOrders, { musicId, musicVolume });
    });
  }

  const creditsDirty = Boolean(
    state &&
      (author !== (state.credits.author ?? "") ||
        translator !== (state.credits.translator ?? "") ||
        genreTags !== state.credits.genreTags)
  );

  function saveCredits() {
    if (!state) return;
    void run(async () => {
      await saveYouTubeCredits(story.id, { author, translator, genreTags });
      await refresh();
      setMessage(t("General info saved."));
    });
  }

  const readyCompilations = (state?.compilations ?? []).filter(
    (record) => record.status === "rendered" || record.status === "error" || record.status === "uploading"
  );

  async function viewCompilationPlan() {
    if (selectedOrders.length === 0) return;
    await run(async () => {
      const plan = await planYouTubeCompilation(story.id, selectedOrders);
      setCompilationPlan(plan);
      if (plan.missing.length > 0) {
        setMessage(t("Narrate these chapters first: {orders}", { orders: plan.missing.join(", ") }));
      } else {
        setMessage(
          t("Plan: {count} chapters · {hours} hours · {parts} parts", {
            count: selectedOrders.length,
            hours: plan.totalHours.toFixed(1),
            parts: plan.parts.length,
          })
        );
      }
    });
  }

  function makeCompilation() {
    if (!compilationPlan || compilationPlan.missing.length > 0) return;
    const parts = compilationPlan.parts.length;
    if (
      !window.confirm(
        t("Make {count} long videos on this computer? Each part can take a few minutes.", { count: parts })
      )
    ) {
      return;
    }
    void run(async () => {
      const publishAt = distributeSchedule(
        Array.from({ length: parts }, (_, index) => index + 1),
        startDate,
        startTime,
        perDay
      );
      await renderYouTubeCompilation(story.id, {
        orders: selectedOrders,
        intro: compilationIntro,
        labelWord: compilationLabelWord,
        musicId,
        musicVolume,
        publishAt,
      });
      setCompilationPlan(null);
    });
  }

  function openCompilationUpload() {
    if (readyCompilations.length === 0) return;
    setCompilationDialogError(null);
    setCompilationNeedsPlaylist(false);
    setCompilationCreatePlaylist(false);
    setCompilationUploadOpen(true);
  }

  function confirmCompilationUpload() {
    void run(async () => {
      try {
        await uploadYouTubeCompilation(
          story.id,
          readyCompilations.map((record) => record.id),
          compilationNeedsPlaylist ? compilationCreatePlaylist : undefined
        );
        setCompilationUploadOpen(false);
      } catch (err) {
        const apiErr = err as { code?: string; message: string };
        if (apiErr.code === "playlist-missing") {
          // The server asks for the confirmation before it creates the playlist.
          setCompilationNeedsPlaylist(true);
          setCompilationDialogError(apiErr.message);
          return;
        }
        setCompilationDialogError(apiErr.message);
      }
    });
  }

  async function removeCompilation(id: string, label: string) {
    if (!window.confirm(t("Remove {label} and its rendered video? The YouTube video stays.", { label }))) return;
    await run(async () => {
      await deleteYouTubeCompilation(story.id, id);
      await refresh();
    });
  }

  async function syncFromYouTube(manual: boolean) {
    try {
      const result = await syncYouTube(story.id);
      if (result.imported > 0) {
        setMessage(t("Synced {count} chapters already on YouTube.", { count: result.imported }));
        await refresh();
      } else if (result.updated > 0) {
        setMessage(t("Filled in the description and tags from YouTube for {count} chapters.", { count: result.updated }));
        await refresh();
      } else if (manual) {
        setMessage(
          result.playlistExists
            ? t("Everything in the playlist is already marked as uploaded.")
            : t("No playlist found on YouTube for this story yet.")
        );
      }
    } catch (err) {
      if (manual) setActionError((err as Error).message);
    }
  }

  function openUpload() {
    if (uploadOrders.length === 0) return;
    setDialogError(null);
    setCreatePlaylist(!playlistMissing);
    setUploadOpen(true);
  }

  function confirmUpload() {
    void run(async () => {
      try {
        await uploadYouTube(story.id, uploadOrders, playlistMissing ? createPlaylist : undefined);
        setUploadOpen(false);
      } catch (err) {
        const apiErr = err as { code?: string; message: string };
        if (apiErr.code === "playlist-missing") {
          setDialogError(t("The playlist \"{name}\" does not exist yet", { name: state?.playlist.title ?? "" }));
          return;
        }
        setDialogError(apiErr.message);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-chrome" role="dialog" aria-modal="true" aria-label={t("YouTube")}>
      <header className="flex h-11 flex-none items-center gap-3 border-b border-rule-2 px-3.5">
        <button type="button" className="btn btn-quiet btn-tiny" onClick={onClose}>
          <Icon name="x" size={12} />
          {t("Close")}
        </button>
        <b className="text-sm">{t("YouTube")}</b>
        <span className="ml-auto truncate text-xs text-ink-3">{story.title}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-5 py-6">
          {!state ? (
            <p className="text-[13px] text-ink-3">{error ?? t("Loading…")}</p>
          ) : (
            <>
              <section className="flex flex-col gap-2 rounded-tool border border-rule bg-raised px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Icon name="youtube" size={16} />
                  {state.connected ? (
                    <span>{t("Connected: {channel}", { channel: state.channel ?? "" })}</span>
                  ) : (
                    <span>{t("Not connected to YouTube yet.")}</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-tiny ml-auto"
                    disabled={busy || !state.connected}
                    onClick={() => void run(async () => void (await syncFromYouTube(true)))}
                  >
                    {t("Sync from YouTube")}
                  </button>
                  <button type="button" className="btn btn-tiny" onClick={onOpenSettings}>
                    {state.connected ? t("YouTube settings") : t("Connect YouTube")}
                  </button>
                </div>
                <p className="text-[12px] leading-snug text-ink-3">
                  {state.playlist.exists ? (
                    <>
                      {t("Playlist:")}{" "}
                      {state.playlist.url ? (
                        <a className="underline" href={state.playlist.url} target="_blank" rel="noreferrer">
                          {state.playlist.title}
                        </a>
                      ) : (
                        state.playlist.title
                      )}
                    </>
                  ) : (
                    t("The playlist \"{name}\" does not exist yet — it will be created only after you confirm it at upload.", {
                      name: state.playlist.title,
                    })
                  )}
                </p>
                {!state.cover && (
                  <p className="text-[12px] text-error">{t("This story has no cover image yet — add one before making videos")}</p>
                )}
                {!state.ffmpeg && (
                  <p className="text-[12px] text-error">
                    {t("ffmpeg was not found. Install it (for example: brew install ffmpeg) or set its path in Settings → YouTube.")}
                  </p>
                )}
              </section>

              <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="field">
                  <span className="label">{t("Author on the video")}</span>
                  <input className="input" value={author} maxLength={200} onChange={(event) => setAuthor(event.target.value)} />
                </label>
                <label className="field">
                  <span className="label">{t("Translator (optional)")}</span>
                  <input className="input" value={translator} maxLength={200} onChange={(event) => setTranslator(event.target.value)} />
                </label>
                <label className="field">
                  <span className="label">{t("Genre tags")}</span>
                  <input className="input" value={genreTags} maxLength={200} onChange={(event) => setGenreTags(event.target.value)} />
                </label>
                <div className="field sm:col-span-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn btn-tiny" disabled={busy || !creditsDirty} onClick={saveCredits}>
                      <Icon name="check" size={13} />
                      {t("Save general info")}
                    </button>
                    <span className="text-[11px] leading-snug text-ink-3">
                      {t("Used for every chapter when you press \"Fill upload info\".")}
                    </span>
                  </div>
                </div>
                <div className="field">
                  <span className="label">{t("Background music")}</span>
                  <div className="flex items-center gap-2">
                    <select
                      className="input"
                      aria-label={t("Background music")}
                      value={musicId}
                      onChange={(event) => setMusicId(event.target.value)}
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
                      onChange={(event) => setMusicVolume(Number(event.target.value))}
                    />
                  </div>
                </div>
                <div className="field sm:col-span-2">
                  <span className="label">{t("Schedule")}</span>
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <input
                      type="date"
                      className="input"
                      aria-label={t("First day")}
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                    />
                    <input
                      type="time"
                      className="input"
                      aria-label={t("Time")}
                      value={startTime}
                      onChange={(event) => setStartTime(event.target.value)}
                    />
                    <label className="flex items-center gap-1">
                      {t("chapters per day")}
                      <input
                        type="number"
                        className="input w-16"
                        min={1}
                        max={50}
                        value={perDay}
                        onChange={(event) => setPerDay(Math.max(1, Number(event.target.value) || 1))}
                      />
                    </label>
                    <button type="button" className="btn btn-quiet btn-tiny" disabled={busy || selectedOrders.length === 0} onClick={applySchedule}>
                      {t("Apply schedule")}
                    </button>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-ink-3">
                    {t("Videos are uploaded as private; a scheduled one becomes public at its time (Vietnam time).")}
                  </p>
                </div>
              </section>

              <section className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-primary" disabled={busy || running !== null || selectedOrders.length === 0} onClick={fillInfo}>
                  <Icon name="sparkles" size={13} />
                  {t("Fill upload info ({count})", { count: selectedOrders.length })}
                </button>
                <button type="button" className="btn" disabled={busy || running !== null || renderOrders.length === 0} onClick={makeVideos}>
                  <Icon name="youtube" size={13} />
                  {t("Make videos ({count})", { count: renderOrders.length })}
                </button>
                <button type="button" className="btn" disabled={busy || running !== null || uploadOrders.length === 0} onClick={openUpload}>
                  <Icon name="upload" size={13} />
                  {t("Upload ({count})", { count: uploadOrders.length })}
                </button>
                {running && (
                  <button type="button" className="btn" onClick={() => void run(async () => void (await stopYouTube(story.id)))}>
                    <Icon name="stop" size={12} />
                    {t("Stop")}
                  </button>
                )}
                <span className="text-xs text-ink-3">{t("{uploaded} chapters on YouTube", { uploaded: uploadedCount })}</span>
              </section>

              {running && (
                <section className="flex flex-col gap-1">
                  <ProgressBar
                    pct={running.total > 0 ? (100 * running.done) / running.total : 0}
                    running
                    label={t("YouTube job progress")}
                  />
                  <p className="text-xs text-ink-2" role="status">
                    {t(
                      running.phase === "prepare"
                        ? "Writing upload info"
                        : running.phase === "render"
                          ? "Making videos"
                          : running.phase === "compilation"
                            ? "Making the compilation"
                            : "Uploading"
                    )}
                    {running.order !== undefined && ` · ${t("Chapter {order}", { order: running.order })}`}
                    {running.percent !== undefined && ` · ${running.percent}%`}
                    {` · ${t("{done}/{total} chapters", { done: running.done, total: running.total })}`}
                    {running.etaMs !== undefined && ` · ${t("{eta} remaining", { eta: formatEta(running.etaMs, lang) })}`}
                  </p>
                </section>
              )}

              {outcome && (
                <p role="status" className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
                  {outcome.cancelled
                    ? t("Stopped: {done}/{total} chapters", { done: outcome.done, total: outcome.total })
                    : t("Finished: {done}/{total} chapters, {failed} errors", {
                        done: outcome.done,
                        total: outcome.total,
                        failed: outcome.failed,
                      })}
                  {outcome.message ? ` — ${outcome.message}` : ""}
                  {outcome.lastError ? ` — ${outcome.lastError}` : ""}
                  <button type="button" className="btn btn-quiet btn-tiny" onClick={dismissOutcome}>
                    <Icon name="x" size={11} />
                  </button>
                </p>
              )}
              {(actionError || error) && (
                <p role="alert" className="text-[12px] text-error">
                  {actionError ?? error}
                </p>
              )}
              {message && (
                <p role="status" className="text-[12px] text-ink-2">
                  {message}
                </p>
              )}

              <section className="overflow-visible">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="w-9" />
                      <th className="num w-11">#</th>
                      <th>{t("Chapter")}</th>
                      <th className="w-32">{t("Status")}</th>
                      <th className="w-36">{t("Publish at")}</th>
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {state.chapters.map((chapter) => (
                      <ChapterRow
                        key={chapter.order}
                        storyId={story.id}
                        chapter={chapter}
                        selected={selected.has(chapter.order)}
                        onToggle={() => toggle(chapter.order)}
                        onSaved={() => void refresh()}
                        disabled={busy || running !== null}
                      />
                    ))}
                  </tbody>
                </table>
                {state.chapters.length === 0 && <p className="py-3 text-[12px] text-ink-3">{t("No crawled chapters yet.")}</p>}
              </section>

              <section className="flex flex-col gap-3 rounded-tool border border-rule bg-raised px-3 py-2.5">
                <div>
                  <div className="text-[13px] font-semibold">{t("Full-story video (compilation)")}</div>
                  <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
                    {t(
                      "Joins the selected chapters into one long video per part (under 11 hours), with a timestamped table of contents in the description."
                    )}
                  </p>
                </div>
                <label className="field">
                  <span className="label">{t("Story intro (2–3 sentences)")}</span>
                  <textarea
                    className="input min-h-20"
                    value={compilationIntro}
                    maxLength={2000}
                    onChange={(event) => setCompilationIntro(event.target.value)}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="input w-40"
                    aria-label={t("Compilation label")}
                    value={compilationLabelWord}
                    onChange={(event) => setCompilationLabelWord(event.target.value)}
                  >
                    <option value="Trọn bộ">Trọn bộ</option>
                    <option value="Tuyển tập">Tuyển tập</option>
                  </select>
                  <button type="button" className="btn btn-tiny" disabled={busy || selectedOrders.length === 0} onClick={() => void viewCompilationPlan()}>
                    {t("View plan")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy || running !== null || !compilationPlan || compilationPlan.missing.length > 0}
                    onClick={makeCompilation}
                  >
                    <Icon name="youtube" size={12} />
                    {t("Make compilation ({count} parts)", { count: compilationPlan?.parts.length ?? 0 })}
                  </button>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy || running !== null || readyCompilations.length === 0}
                    onClick={openCompilationUpload}
                  >
                    <Icon name="upload" size={12} />
                    {t("Upload compilation ({count})", { count: readyCompilations.length })}
                  </button>
                </div>
                <p className="text-[11px] leading-snug text-ink-3">
                  {t("The playlist for compilations: {name}", { name: state.compilationPlaylist })}
                </p>
                {state.compilations.length > 0 && (
                  <ul className="flex flex-col gap-1 text-[12px]">
                    {state.compilations.map((record) => {
                      const chip = statusChip(record, t);
                      return (
                        <li key={record.id} className="flex items-center gap-2 border-b border-rule pb-1 last:border-b-0">
                          {chip && <StatusChip state={chip.state} label={chip.label} />}
                          <span className="min-w-0 flex-1 truncate">{record.label}</span>
                          <span className="text-ink-3">{record.videoSeconds ? `${Math.round(record.videoSeconds / 3600)} h` : ""}</span>
                          {record.error && <span className="min-w-0 flex-1 truncate text-error">{record.error}</span>}
                          {record.videoUrl && (
                            <a className="btn btn-quiet btn-tiny px-1" href={record.videoUrl} target="_blank" rel="noreferrer" title={t("Open on YouTube")}>
                              <Icon name="open" size={12} />
                            </a>
                          )}
                          {!record.videoUrl && record.videoPath && (
                            <a className="btn btn-quiet btn-tiny px-1" href={youTubeCompilationVideoUrl(story.id, record.id)} target="_blank" rel="noreferrer" title={t("Watch the rendered part")}>
                              <Icon name="play" size={12} />
                            </a>
                          )}
                          {record.status !== "uploading" && (
                            <button
                              type="button"
                              className="btn btn-quiet btn-tiny px-1"
                              aria-label={t("Remove {label}", { label: record.label })}
                              disabled={busy || running !== null}
                              onClick={() => void removeCompilation(record.id, record.label)}
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {compilationUploadOpen && state && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCompilationUploadOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("Upload compilation")}
            className="flex max-h-full w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-tool border border-rule bg-chrome p-4"
          >
            <h3 className="text-sm font-semibold">
              {t("Upload {count} long videos to YouTube", { count: readyCompilations.length })}
            </h3>
            <p className="text-[12px] leading-snug text-ink-2">
              {t("Every video is uploaded as private. A scheduled video becomes public by itself at its publish time.")}
            </p>
            <ul className="flex flex-col gap-0.5 text-[12px] text-ink-2">
              {readyCompilations.map((record) => (
                <li key={record.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">{record.label}</span>
                  <span className="shrink-0 text-ink-3">
                    {record.publishAt ? formatPublishAt(record.publishAt) : t("private, no schedule")}
                  </span>
                </li>
              ))}
            </ul>
            {compilationNeedsPlaylist && (
              <label className="flex items-start gap-2 rounded-tool border border-rule-2 bg-raised px-2.5 py-2 text-[12px]">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 accent-select"
                  checked={compilationCreatePlaylist}
                  onChange={(event) => setCompilationCreatePlaylist(event.target.checked)}
                />
                <span>{t("Create the playlist \"{name}\" (public, one per story).", { name: state.compilationPlaylist })}</span>
              </label>
            )}
            {compilationDialogError && (
              <p role="alert" className="text-[12px] text-error">
                {compilationDialogError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="btn btn-quiet" onClick={() => setCompilationUploadOpen(false)}>
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || (compilationNeedsPlaylist && !compilationCreatePlaylist)}
                onClick={confirmCompilationUpload}
              >
                <Icon name="upload" size={13} />
                {t("Upload now")}
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadOpen && state && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setUploadOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("Upload to YouTube")}
            className="flex max-h-full w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-tool border border-rule bg-chrome p-4"
          >
            <h3 className="text-sm font-semibold">{t("Upload {count} videos to YouTube", { count: uploadOrders.length })}</h3>
            <p className="text-[12px] leading-snug text-ink-2">
              {t("Every video is uploaded as private. A scheduled video becomes public by itself at its publish time.")}
            </p>
            <ul className="flex flex-col gap-0.5 text-[12px] text-ink-2">
              {uploadOrders.slice(0, 8).map((order) => {
                const record = byOrder.get(order)?.record;
                return (
                  <li key={order} className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      {t("Chapter {order}", { order })} — {record?.title ?? byOrder.get(order)?.title}
                    </span>
                    <span className="shrink-0 text-ink-3">
                      {record?.publishAt ? formatPublishAt(record.publishAt) : t("private, no schedule")}
                    </span>
                  </li>
                );
              })}
              {uploadOrders.length > 8 && <li className="text-ink-3">{t("…and {count} more", { count: uploadOrders.length - 8 })}</li>}
            </ul>
            {playlistMissing && (
              <label className="flex items-start gap-2 rounded-tool border border-rule-2 bg-raised px-2.5 py-2 text-[12px]">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 accent-select"
                  checked={createPlaylist}
                  onChange={(event) => setCreatePlaylist(event.target.checked)}
                />
                <span>{t("Create the playlist \"{name}\" (public, one per story).", { name: state.playlist.title })}</span>
              </label>
            )}
            <p className="text-[11px] leading-snug text-ink-3">
              {t("YouTube's API allows about 6 uploads a day; the run stops when the quota is reached and can be resumed later.")}
            </p>
            {dialogError && (
              <p role="alert" className="text-[12px] text-error">
                {dialogError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="btn btn-quiet" onClick={() => setUploadOpen(false)}>
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || (playlistMissing && !createPlaylist)}
                onClick={confirmUpload}
              >
                <Icon name="upload" size={13} />
                {t("Upload now")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function statusChip(
  record: { status: string } | undefined,
  t: (key: string, params?: Record<string, string | number>) => string
): { state: ChipState; label: string } | null {
  if (!record) return null;
  switch (record.status) {
    case "draft":
      return { state: "pending", label: t("Draft") };
    case "rendering":
      return { state: "running", label: t("Rendering…") };
    case "rendered":
      return { state: "done", label: t("Video ready") };
    case "uploading":
      return { state: "running", label: t("Uploading…") };
    case "uploaded":
      return { state: "done", label: t("Uploaded") };
    case "error":
      return { state: "error", label: t("Error") };
    default:
      return null;
  }
}

function ChapterRow({
  storyId,
  chapter,
  selected,
  onToggle,
  onSaved,
  disabled,
}: {
  storyId: string;
  chapter: YouTubeChapterState;
  selected: boolean;
  onToggle: () => void;
  onSaved: () => void;
  disabled: boolean;
}) {
  const { t } = useLang();
  const record = chapter.record;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(record?.title ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [tags, setTags] = useState(record?.tags ?? "");
  const [publishAt, setPublishAt] = useState(localInputValue(record?.publishAt));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const uploaded = record?.status === "uploaded";
  const chip = statusChip(record, t);

  useEffect(() => {
    setTitle(record?.title ?? "");
    setDescription(record?.description ?? "");
    setTags(record?.tags ?? "");
    setPublishAt(localInputValue(record?.publishAt));
  }, [record?.updatedAt, record?.title, record?.description, record?.tags, record?.publishAt]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveYouTubeChapter(storyId, chapter.order, {
        title,
        description,
        tags,
        publishAt: publishAt ? isoFromLocalInput(publishAt) ?? null : null,
      });
      onSaved();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const question = record?.videoId
      ? t("Remove this chapter from the app? The video stays on YouTube.")
      : t("Remove this chapter's upload info and its rendered video?");
    if (!window.confirm(question)) return;
    setSaving(true);
    setSaveError(null);
    try {
      await deleteYouTubeChapter(storyId, chapter.order);
      onSaved();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr className={open ? "row-open" : undefined}>
        <td>
          <input
            type="checkbox"
            className="size-3.5 accent-select"
            aria-label={t("Choose chapter {order}", { order: chapter.order })}
            checked={selected}
            disabled={disabled || !chapter.hasAudio || uploaded}
            onChange={onToggle}
          />
        </td>
        <td className="num w-11">
          <b>{chapter.order}</b>
        </td>
        <td>
          <button type="button" className="row-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name="chevron" size={13} className={`text-ink-3 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
            <span className="t">{chapter.title}</span>
            {chapter.audioChanged && <span className="chip chip-new shrink-0">{t("Audio changed")}</span>}
            {!chapter.hasAudio && <span className="chip shrink-0">{t("No audio yet")}</span>}
          </button>
        </td>
        <td className="w-32">{chip ? <StatusChip state={chip.state} label={chip.label} /> : <span className="text-ink-3">—</span>}</td>
        <td className="w-36 text-[12px] text-ink-2">{record?.publishAt ? formatPublishAt(record.publishAt) : "—"}</td>
        <td className="w-20">
          {record && record.status !== "uploading" && (
            <button
              type="button"
              className="btn btn-quiet btn-tiny px-1"
              title={t("Remove")}
              aria-label={t("Remove")}
              disabled={disabled || saving}
              onClick={() => void remove()}
            >
              <Icon name="trash" size={13} />
            </button>
          )}
          {uploaded && record?.videoUrl && (
            <a className="btn btn-quiet btn-tiny px-1" href={record.videoUrl} target="_blank" rel="noreferrer" title={t("Open on YouTube")}>
              <Icon name="open" size={13} />
            </a>
          )}
        </td>
      </tr>
      {open && (
        <tr className="chapter-open">
          <td colSpan={6}>
            {record ? (
              <div className="flex flex-col gap-3 p-3">
                {record.error && (
                  <p role="alert" className="text-[12px] text-error">
                    {record.error}
                  </p>
                )}
                <label className="field">
                  <span className="label">{t("Title")}</span>
                  <input className="input" value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label className="field">
                  <span className="label">{t("Description")}</span>
                  <textarea className="input min-h-40" value={description} maxLength={5000} onChange={(event) => setDescription(event.target.value)} />
                </label>
                <label className="field">
                  <span className="label">{t("Tags (comma separated)")}</span>
                  <input className="input" value={tags} maxLength={500} onChange={(event) => setTags(event.target.value)} />
                </label>
                <label className="field">
                  <span className="label">{t("Publish at")}</span>
                  <input type="datetime-local" className="input" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-primary btn-tiny" disabled={saving || disabled} onClick={() => void save()}>
                    {saving ? t("Saving…") : t("Save this chapter's info")}
                  </button>
                  {record.videoPath && (
                    <video controls preload="metadata" className="max-h-56 w-full max-w-md rounded-tool" src={youTubeVideoUrl(storyId, chapter.order)} />
                  )}
                </div>
                {saveError && (
                  <p role="alert" className="text-[12px] text-error">
                    {saveError}
                  </p>
                )}
              </div>
            ) : (
              <p className="p-3 text-[12px] text-ink-3">{t("Choose this chapter and press \"Fill upload info\" first.")}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
