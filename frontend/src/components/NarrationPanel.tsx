import { ReactNode, useEffect, useState } from "react";
import { deleteStoryAudio, exportStoryAudio, fetchTtsStatus } from "../lib/api";
import { formatBytes } from "../lib/formatBytes";
import { formatEta } from "../lib/formatEta";
import { useLang } from "../i18n";
import { NarrationOutcome } from "../hooks/useNarration";
import { NarrationState } from "../types";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressBar";

/**
 * The story page's narration block: how many chapters have audio, the job in flight,
 * and the buttons to start or stop it. Vietnamese stories only — StoryDetail does not
 * render it for others. Narration runs server-side; this only reflects it.
 */
export default function NarrationPanel({
  storyId,
  state,
  outcome,
  error,
  onStart,
  onStop,
  onDismissOutcome,
  onOpenSettings,
  onAudioDeleted,
  actions,
}: {
  storyId: string;
  state: NarrationState;
  outcome: NarrationOutcome | null;
  error: string | null;
  onStart: () => void;
  onStop: () => void;
  onDismissOutcome: () => void;
  onOpenSettings: () => void;
  // After "Delete audio": the page refetches which chapters have narration.
  onAudioDeleted: () => void;
  // Export buttons, placed with the others.
  actions?: ReactNode;
}) {
  const audioExport = useAudioExport(storyId);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Audio made with an earlier voice keeps playing; deleting it is how to re-voice a story.
  async function handleDeleteAudio() {
    if (!window.confirm(t("Delete this story's narration? Chapters can be narrated again afterwards."))) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStoryAudio(storyId);
      onAudioDeleted();
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  const { lang, t } = useLang();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    fetchTtsStatus()
      .then((status) => setInstalled(status.state === "installed"))
      .catch(() => setInstalled(null));
  }, []);

  const running = state.running;
  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);

  const states = Object.values(state.chapters);
  const ready = states.filter((s) => s === "ready").length;
  const missing = states.length - ready;

  // Until the engine is installed (and while the story has no audio yet) the block is one
  // line pointing to Settings: the full block would only hold dead buttons, pushing the
  // chapter list down on every Vietnamese story for readers who never narrate.
  if (installed === null && !running) return null;
  if (installed === false && ready === 0 && !running && state.bytes === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-tool border border-rule bg-raised px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="narration" size={14} />
          {t("Narration")}
        </span>
        <span className="text-xs text-ink-3">{t("Turn chapters into audio with a voice model on this machine.")}</span>
        <button type="button" className="btn btn-tiny ml-auto" onClick={onOpenSettings}>
          <Icon name="settings" size={12} />
          {t("Set up narration")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-tool border border-rule bg-raised px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="narration" size={14} />
          {t("Narration")}
        </span>
        <span className="text-xs text-ink-2">
          {t("{ready}/{total} chapters narrated", { ready, total: states.length })}
          {state.bytes > 0 && ` · ${formatBytes(state.bytes)}`}
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-2">
          {running ? (
            <button
              type="button"
              className="btn btn-tiny"
              disabled={stopping}
              onClick={() => {
                setStopping(true);
                onStop();
              }}
            >
              <Icon name="stop" size={11} />
              {stopping ? t("Stopping…") : t("Stop narration")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-tiny btn-primary"
              disabled={!installed || missing === 0}
              onClick={onStart}
            >
              <Icon name="play" size={11} />
              {t("Narrate ({count} chapters)", { count: missing })}
            </button>
          )}
          <button
            type="button"
            className="btn btn-tiny"
            disabled={ready === 0 || audioExport.exporting}
            onClick={() => void audioExport.run()}
          >
            <Icon name="download" size={12} />
            {audioExport.exporting ? t("Preparing audio…") : t("Export audio (.zip)")}
          </button>
          {state.bytes > 0 && !running && (
            <button type="button" className="btn btn-quiet btn-tiny" disabled={deleting} onClick={() => void handleDeleteAudio()}>
              <Icon name="trash" size={12} />
              {deleting ? t("Deleting…") : t("Delete audio")}
            </button>
          )}
          {actions}
        </span>
      </div>

      {installed === false && (
        <p className="text-xs text-ink-3">{t("Narration is not installed — reinstall it in Settings → Narration to narrate more chapters.")}</p>
      )}

      {running && (
        <div className="flex flex-col gap-1">
          <ProgressBar
            pct={running.total > 0 ? (100 * running.done) / running.total : 0}
            running
            label={t("Narration progress")}
          />
          <p className="text-xs text-ink-2" role="status">
            {running.order !== undefined && running.parts
              ? t("Reading chapter {order} — part {part}/{parts}", {
                  order: running.order,
                  part: running.part ?? 0,
                  parts: running.parts,
                })
              : t("Loading the voice model…")}
            {" · "}
            {t("{done}/{total} chapters", { done: running.done, total: running.total })}
            {running.etaMs !== undefined && ` · ${t("{eta} remaining", { eta: formatEta(running.etaMs, lang) })}`}
          </p>
        </div>
      )}

      {outcome && !running && (
        <p className={`flex items-start gap-2 text-xs ${outcome.failed > 0 ? "text-error" : "text-ink-2"}`} role="status">
          <Icon name={outcome.failed > 0 ? "alert" : "check"} size={13} />
          <span className="min-w-0">
            {outcome.cancelled
              ? t("Narration stopped: {done}/{total} chapters have audio.", { done: outcome.done, total: outcome.total })
              : t("Narration finished: {done}/{total} chapters have audio.", { done: outcome.done, total: outcome.total })}
            {outcome.failed > 0 && ` ${t("{count} failed: {message}", { count: outcome.failed, message: outcome.lastError ?? "" })}`}
          </span>
          <button type="button" className="btn btn-quiet btn-tiny ml-auto" onClick={onDismissOutcome} aria-label={t("Close")}>
            <Icon name="x" size={11} />
          </button>
        </p>
      )}

      {audioExport.message && (
        <p className="text-xs text-ink-2" role="status">
          {audioExport.message}
        </p>
      )}

      {(error || audioExport.error || deleteError) && (
        <p className="flex items-center gap-2 text-xs text-error" role="alert">
          <Icon name="alert" size={13} />
          {error || audioExport.error || deleteError}
        </p>
      )}
    </div>
  );
}

/**
 * "Export audio": the server zips the narrated chapters to a temp file, then the zip is
 * saved without passing through this page's memory — the packaged app streams it into
 * a folder the reader picks (electron/main.js), a browser downloads it from a link.
 */
function useAudioExport(storyId: string) {
  const { t } = useLang();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (exporting) return;
    setError(null);
    setMessage(null);
    setExporting(true);
    try {
      const bridge = window.electronExport;
      const folder = bridge ? await bridge.pickFolder() : null;
      if (bridge && folder === null) return;
      const created = await exportStoryAudio(storyId);
      if (bridge && folder !== null) {
        await bridge.saveUrl(folder, created.fileName, `${window.location.origin}${created.url}`);
      } else {
        const a = document.createElement("a");
        a.href = created.url;
        a.download = created.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setMessage(
        created.missing.length > 0
          ? t("Exported {count} chapters. {missing} chapters have no audio yet and were left out.", {
              count: created.count,
              missing: created.missing.length,
            })
          : t("Exported {count} chapters.", { count: created.count })
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return { exporting, error, message, run };
}
