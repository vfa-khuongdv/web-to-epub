import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { deleteTtsVoice, fetchTtsStatus, fetchTtsVoices, installTts, previewTts, uninstallTts, uploadTtsVoice } from "../lib/api";
import { formatBytes } from "../lib/formatBytes";
import { useLang } from "../i18n";
import { AppSettings, TtsEngine, TtsStatus, TtsVariant, TtsVoice } from "../types";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressBar";

// Install runs server-side for minutes; the page polls while it does.
const INSTALL_POLL_MS = 1000;
// Same cap as the server (src/services/tts/customVoices.ts), checked before uploading.
const MAX_VOICE_BYTES = 10 * 1024 * 1024;

const PHASE_LABEL: Record<NonNullable<TtsStatus["phase"]>, string> = {
  uv: "Downloading the installer…",
  python: "Setting up Python…",
  packages: "Installing {name}…",
  model: "Downloading the voice model…",
};

const ENGINE_NAME: Record<TtsEngine, string> = { omnivoice: "OmniVoice", vieneu: "VieNeu-TTS" };

export function engineOf(variant: TtsVariant): TtsEngine {
  return variant === "omnivoice" ? "omnivoice" : "vieneu";
}

/**
 * Settings → Narration: picks the engine (OmniVoice or VieNeu-TTS — each a separate
 * install the app runs itself, under the library folder), installs it, picks the model
 * and the voice, and plays a sample. Chapters are narrated from the story page; this is
 * only the engine.
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
  const engine = engineOf(settings.ttsVariant);
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (disk = false) => {
      try {
        setStatus(await fetchTtsStatus(disk, engine));
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [engine]
  );

  useEffect(() => {
    setStatus(null);
    setError(null);
    void refresh(true);
  }, [refresh]);

  const installing = status?.state === "installing";
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(async () => {
      const next = await fetchTtsStatus(false, engine).catch(() => null);
      if (!next || next.engine !== engine) return;
      setStatus(next);
      // Size once, when it lands.
      if (next.state !== "installing") void refresh(true);
    }, INSTALL_POLL_MS);
    return () => clearInterval(timer);
  }, [installing, refresh, engine]);

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
      setStatus(await uninstallTts(engine));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Preset voice ids belong to one model, so a switch goes back to its default voice; a
  // custom voice works with every model and stays.
  function switchTo(variant: TtsVariant) {
    if (settings.ttsVariant === variant) return;
    void onSave({ ttsVariant: variant, ttsVoice: settings.ttsVoice.startsWith("custom:") ? settings.ttsVoice : "" });
  }

  const enginePicker = (
    <Row
      label={t("Engine")}
      hint={t("OmniVoice sounds more natural but is several times slower and needs a voice of your own; VieNeu-TTS is faster and has voices built in.")}
      control={
        <div className="tabs">
          {(["omnivoice", "vieneu"] as TtsEngine[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-selected={engine === option}
              disabled={installing}
              onClick={() => engine !== option && switchTo(option === "omnivoice" ? "omnivoice" : "turbo")}
            >
              {ENGINE_NAME[option]}
            </button>
          ))}
        </div>
      }
    />
  );

  if (!status) {
    return (
      <>
        {enginePicker}
        {error ? <ErrorLine message={error} /> : <p className="text-[12px] text-ink-3">{t("Checking narration…")}</p>}
      </>
    );
  }

  if (!status.supported) {
    return (
      <>
        {enginePicker}
        <Row
          label={t("Narration engine")}
          hint={engine === "omnivoice" ? t("OmniVoice needs a Mac with Apple Silicon or a PC with an NVIDIA GPU.") : t("Narration is not supported on this platform.")}
          control={null}
        />
      </>
    );
  }

  const downloadPct = status.total ? (100 * (status.downloaded ?? 0)) / status.total : 0;

  return (
    <>
      {error && <ErrorLine message={error} />}
      {enginePicker}
      <Row
        label={t("Narration engine")}
        hint={
          status.state === "installed" ? (
            t("{name} {version}, running on this machine. {size} on disk.", {
              name: ENGINE_NAME[engine],
              version: status.version,
              size: status.diskBytes !== undefined ? formatBytes(status.diskBytes) : "…",
            })
          ) : installing ? (
            <span className="flex flex-col gap-1.5">
              <span role="status">{t(status.phase ? PHASE_LABEL[status.phase] : "Starting…", { name: ENGINE_NAME[engine] })}</span>
              <ProgressBar
                pct={status.phase === "uv" ? downloadPct : 100}
                running={status.phase !== "uv"}
                label={t("Installing narration")}
              />
            </span>
          ) : (
            <>
              {engine === "omnivoice"
                ? t(
                    "Reads Vietnamese chapters aloud with OmniVoice on this Mac's GPU, in a voice you upload. Installing downloads about 4.5 GB (Python, PyTorch and the model) into the library folder. The model is licensed for non-commercial use only (CC BY-NC)."
                  )
                : t(
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

      {engine === "vieneu" && (
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
                  onClick={() => switchTo(variant)}
                >
                  {variant === "turbo" ? t("Quality") : t("Fast")}
                </button>
              ))}
            </div>
          }
        />
      )}

      {/* Shown before installing too: the voices and their samples ship with the app. */}
      <VoicePicker
        key={settings.ttsVariant}
        settings={settings}
        onSave={onSave}
        Row={Row}
        onError={setError}
      />
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
  // The voice whose sample is being fetched, and the one playing.
  const [loading, setLoading] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // A picked clip waiting for its name. Inline rather than window.prompt, which Electron
  // does not implement (it returns nothing, so the upload silently never happened).
  const [pending, setPending] = useState<{ file: File; name: string; transcript: string } | null>(null);
  // OmniVoice has no voices of its own: its list is the clips shipped with the app and the user's.
  const omnivoice = settings.ttsVariant === "omnivoice";
  const audio = useRef<HTMLAudioElement>();
  const audioUrl = useRef<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTtsVoices(settings.ttsVariant)
      .then((list) => !cancelled && setVoices(list))
      .catch((err: Error) => !cancelled && onError(err.message));
    return () => {
      cancelled = true;
    };
  }, [settings.ttsVariant, onError]);

  function stop() {
    audio.current?.pause();
    audio.current = undefined;
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = undefined;
    setPlaying(null);
  }

  useEffect(() => stop, []);

  // Samples are rendered ahead of time, so this is instant; only a voice without one
  // (a freshly uploaded clip) is rendered, once, by the engine.
  async function handlePreview(id: string) {
    const wasPlaying = playing === id;
    stop();
    if (wasPlaying) return;
    onError(null);
    setLoading(id);
    try {
      const blob = await previewTts(settings.ttsVariant, id);
      audioUrl.current = URL.createObjectURL(blob);
      const player = new Audio(audioUrl.current);
      audio.current = player;
      player.onended = () => audio.current === player && setPlaying(null);
      await player.play();
      setPlaying(id);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  function handlePick(file: File) {
    onError(null);
    if (file.size > MAX_VOICE_BYTES) {
      onError(t("The voice clip is too large (10 MB at most)"));
      return;
    }
    setPending({ file, name: file.name.replace(/\.[^.]+$/, ""), transcript: "" });
  }

  async function handleUpload() {
    const name = pending?.name.trim();
    if (!pending || !name) return;
    onError(null);
    setUploading(true);
    try {
      const voice = await uploadTtsVoice(name, pending.file, pending.transcript);
      setVoices((list) => [...(list ?? []), voice]);
      setPending(null);
      await onSave({ ttsVoice: voice.id });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(voice: TtsVoice) {
    if (!window.confirm(t("Remove the voice “{name}”? Chapters already narrated with it are kept.", { name: voice.label }))) return;
    onError(null);
    try {
      if (playing === voice.id) stop();
      await deleteTtsVoice(voice.id);
      setVoices((list) => list?.filter((v) => v.id !== voice.id) ?? null);
      // The server has already reset the setting when it was this one; mirror it.
      if (settings.ttsVoice === voice.id) await onSave({ ttsVoice: "" });
    } catch (err) {
      onError((err as Error).message);
    }
  }

  const options: TtsVoice[] = voices ? [...(omnivoice ? [] : [{ id: "", label: t("Model default") }]), ...voices] : [];

  return (
    <>
      <Row
        label={t("Voice")}
        hint={
          omnivoice && !settings.ttsVoice
            ? t("OmniVoice has no default voice: pick one below, or upload a clean clip of 5–15 seconds (MP3, WAV, FLAC or OGG), one speaker, no music. Only use a voice you have the right to use.")
            : t("Press ▶ to hear a voice. Your own voice: upload a clean clip of 5–15 seconds (MP3, WAV, FLAC or OGG), one speaker, no music. Only use a voice you have the right to use.")
        }
        control={
          <button type="button" className="btn btn-tiny" onClick={() => fileInput.current?.click()} disabled={uploading}>
            <Icon name="upload" size={12} />
            {uploading ? t("Uploading…") : t("Upload a voice…")}
          </button>
        }
      />
      <input
        ref={fileInput}
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/ogg,.mp3,.wav,.flac,.ogg"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) handlePick(file);
        }}
      />
      {pending && (
        <form
          className="flex w-full flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void handleUpload();
          }}
        >
          <input
            className="input w-56"
            aria-label={t("Name for this voice")}
            placeholder={t("Name for this voice")}
            value={pending.name}
            maxLength={60}
            autoFocus
            onChange={(event) => setPending({ ...pending, name: event.target.value })}
          />
          <input
            className="input w-full"
            aria-label={t("What is said in the clip")}
            placeholder={t("What is said in the clip (optional — OmniVoice transcribes it if left blank)")}
            value={pending.transcript}
            maxLength={1000}
            onChange={(event) => setPending({ ...pending, transcript: event.target.value })}
          />
          <button type="submit" className="btn btn-tiny btn-primary" disabled={uploading || !pending.name.trim()}>
            <Icon name="upload" size={12} />
            {uploading ? t("Uploading…") : t("Upload")}
          </button>
          <button type="button" className="btn btn-tiny" onClick={() => setPending(null)} disabled={uploading}>
            {t("Cancel")}
          </button>
        </form>
      )}
      {!voices ? (
        <p className="text-[12px] text-ink-3">{t("Loading voices…")}</p>
      ) : options.length === 0 ? (
        <p className="text-[12px] text-ink-3">{t("No voices yet — upload one above.")}</p>
      ) : (
        <ul
          role="radiogroup"
          aria-label={t("Voice")}
          className="max-h-72 overflow-y-auto rounded-tool border border-rule bg-content"
        >
          {options.map((voice) => {
            const selected = settings.ttsVoice === voice.id;
            const busy = loading === voice.id;
            return (
              <li
                key={voice.id}
                className={`flex items-center gap-2 border-b border-rule px-2.5 py-1 last:border-b-0 ${selected ? "bg-select-soft" : "hover:bg-row-hover"}`}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-0.5 text-[13px]">
                  <input
                    type="radio"
                    name="tts-voice"
                    checked={selected}
                    onChange={() => void onSave({ ttsVoice: voice.id })}
                  />
                  <span className="truncate">{voice.label}</span>
                  {voice.custom && <span className="flex-none text-[11px] text-ink-3">{t("Your voice")}</span>}
                </label>
                <button
                  type="button"
                  className="btn btn-tiny"
                  aria-label={t("Preview “{name}”", { name: voice.label })}
                  title={busy ? t("Generating…") : t("Preview")}
                  disabled={loading !== null && !busy}
                  onClick={() => void handlePreview(voice.id)}
                >
                  <Icon name={playing === voice.id ? "stop" : "play"} size={12} />
                  {busy && t("Generating…")}
                </button>
                {voice.custom && (
                  <button
                    type="button"
                    className="btn btn-tiny"
                    aria-label={t("Remove this voice")}
                    title={t("Remove this voice")}
                    onClick={() => void handleDelete(voice)}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
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
