import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { fetchTtsStatus, fetchTtsVoices, installTts, previewTts, uninstallTts } from "../lib/api";
import { formatBytes } from "../lib/formatBytes";
import { useLang } from "../i18n";
import { AppSettings, TtsStatus, TtsVariant, TtsVoice } from "../types";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressBar";

// Install runs server-side for minutes; the page polls while it does.
const INSTALL_POLL_MS = 1000;

const PHASE_LABEL: Record<NonNullable<TtsStatus["phase"]>, string> = {
  uv: "Downloading the installer…",
  python: "Setting up Python…",
  packages: "Installing VieNeu-TTS…",
  model: "Downloading the voice model…",
};

/**
 * Settings → Narration: installs VieNeu-TTS (the app runs it itself, under the library
 * folder), picks the model and the voice, and plays a sample. Chapters are narrated from
 * the story page; this is only the engine.
 */
export default function NarrationSettings({
  settings,
  onSave,
  Row,
}: {
  settings: AppSettings;
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
  Row: (props: { label: string; hint?: ReactNode; control: ReactNode }) => JSX.Element;
}) {
  const { t } = useLang();
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (disk = false) => {
    try {
      setStatus(await fetchTtsStatus(disk));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  const installing = status?.state === "installing";
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(async () => {
      const next = await fetchTtsStatus().catch(() => null);
      if (!next) return;
      setStatus(next);
      // Size once, when it lands.
      if (next.state !== "installing") void refresh(true);
    }, INSTALL_POLL_MS);
    return () => clearInterval(timer);
  }, [installing, refresh]);

  async function handleInstall() {
    setError(null);
    try {
      setStatus(await installTts(settings.ttsVariant));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUninstall() {
    if (!window.confirm(t("Remove the narration engine and its voice models? Narrated chapters are kept."))) return;
    setError(null);
    try {
      setStatus(await uninstallTts());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!status) {
    return error ? <ErrorLine message={error} /> : <p className="text-[12px] text-ink-3">{t("Checking narration…")}</p>;
  }

  if (!status.supported) {
    return <Row label={t("Narration engine")} hint={t("Narration is not supported on this platform.")} control={null} />;
  }

  const downloadPct = status.total ? (100 * (status.downloaded ?? 0)) / status.total : 0;

  return (
    <>
      {error && <ErrorLine message={error} />}
      <Row
        label={t("Narration engine")}
        hint={
          status.state === "installed" ? (
            t("VieNeu-TTS {version}, running on this machine. {size} on disk.", {
              version: status.version,
              size: status.diskBytes !== undefined ? formatBytes(status.diskBytes) : "…",
            })
          ) : installing ? (
            <span className="flex flex-col gap-1.5">
              <span role="status">{t(status.phase ? PHASE_LABEL[status.phase] : "Starting…")}</span>
              <ProgressBar
                pct={status.phase === "uv" ? downloadPct : 100}
                running={status.phase !== "uv"}
                label={t("Installing narration")}
              />
            </span>
          ) : (
            <>
              {t(
                "Reads Vietnamese chapters aloud with VieNeu-TTS, entirely on this machine. Installing downloads about 1.3 GB (Python, packages and a voice model) into the library folder."
              )}
              {status.state === "error" && status.error && (
                <span className="mt-1 block text-error">{t("Install failed: {message}", { message: status.error })}</span>
              )}
            </>
          )
        }
        control={
          status.state === "installed" ? (
            <button type="button" className="btn btn-tiny" onClick={() => void handleUninstall()} disabled={status.busy}>
              <Icon name="trash" size={12} />
              {t("Uninstall")}
            </button>
          ) : installing ? null : (
            <button type="button" className="btn btn-tiny btn-primary" onClick={() => void handleInstall()}>
              <Icon name="download" size={12} />
              {status.state === "error" ? t("Try again") : t("Install")}
            </button>
          )
        }
      />

      <Row
        label={t("Model")}
        hint={t("Quality reads more naturally; Fast takes about half the time. Each model downloads once, the first time it is used.")}
        control={
          <div className="tabs">
            {(["turbo", "nano"] as TtsVariant[]).map((variant) => (
              <button
                key={variant}
                type="button"
                aria-selected={settings.ttsVariant === variant}
                disabled={installing}
                // Voice ids belong to one model, so a switch goes back to its default voice.
                onClick={() => settings.ttsVariant !== variant && void onSave({ ttsVariant: variant, ttsVoice: "" })}
              >
                {variant === "turbo" ? t("Quality") : t("Fast")}
              </button>
            ))}
          </div>
        }
      />

      {status.state === "installed" && (
        <VoicePicker key={settings.ttsVariant} settings={settings} onSave={onSave} Row={Row} onError={setError} />
      )}
    </>
  );
}

function VoicePicker({
  settings,
  onSave,
  Row,
  onError,
}: {
  settings: AppSettings;
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
  Row: (props: { label: string; hint?: ReactNode; control: ReactNode }) => JSX.Element;
  onError: (message: string | null) => void;
}) {
  const { t } = useLang();
  const [voices, setVoices] = useState<TtsVoice[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const audioUrl = useRef<string>();

  useEffect(() => {
    let cancelled = false;
    fetchTtsVoices(settings.ttsVariant)
      .then((list) => !cancelled && setVoices(list))
      .catch((err: Error) => !cancelled && onError(err.message));
    return () => {
      cancelled = true;
    };
  }, [settings.ttsVariant, onError]);

  useEffect(
    () => () => {
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    },
    []
  );

  async function handlePreview() {
    onError(null);
    setPreviewing(true);
    try {
      const blob = await previewTts(settings.ttsVariant, settings.ttsVoice);
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(blob);
      await new Audio(audioUrl.current).play();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <Row
      label={t("Voice")}
      hint={voices ? undefined : t("Loading the model — the first time this downloads it, which takes a few minutes.")}
      control={
        <>
          <select
            className="input w-56"
            aria-label={t("Voice")}
            value={settings.ttsVoice}
            disabled={!voices}
            onChange={(event) => void onSave({ ttsVoice: event.target.value })}
          >
            <option value="">{t("Model default")}</option>
            {voices?.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-tiny" onClick={() => void handlePreview()} disabled={!voices || previewing}>
            <Icon name="play" size={12} />
            {previewing ? t("Generating…") : t("Preview")}
          </button>
        </>
      }
    />
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-error" role="alert">
      <Icon name="alert" size={13} />
      {message}
    </p>
  );
}
