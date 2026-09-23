import { useEffect, useState } from "react";
import { useLang } from "../i18n";
import { AppUpdateInfo } from "../types";
import { Icon } from "./Icon";

type InstallState =
  | { phase: "idle" }
  | { phase: "downloading"; pct: number | null }
  | { phase: "installing" }
  | { phase: "error"; message: string };

// A new release was found when the app opened. Inside the packaged app the primary
// button downloads the zip, the app replaces itself and restarts (electron/main.js);
// anywhere else it is a link to the release page. "Later" (or Escape / the backdrop)
// hides it until the next app open.
export function UpdateDialog({ update, onDismiss }: { update: AppUpdateInfo; onDismiss: () => void }) {
  const { t } = useLang();
  const [state, setState] = useState<InstallState>({ phase: "idle" });
  const bridge = window.electronUpdate;
  const busy = state.phase === "downloading" || state.phase === "installing";

  useEffect(() => {
    if (!bridge) return;
    return bridge.onProgress((progress) => {
      if (progress.installing) {
        setState({ phase: "installing" });
        return;
      }
      setState({
        phase: "downloading",
        pct:
          progress.total && progress.total > 0
            ? Math.round(((progress.received ?? 0) / progress.total) * 100)
            : null,
      });
    });
  }, [bridge]);

  // The dialog stays put while the download/install runs: closing it would hide the
  // only progress UI, and the app restarts on its own when the update lands.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss, busy]);

  async function install() {
    if (!bridge || !update.zipUrl) return;
    setState({ phase: "downloading", pct: null });
    try {
      await bridge.install(update.zipUrl);
    } catch (err) {
      setState({ phase: "error", message: (err as Error).message });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onDismiss()}
    >
      <div
        className="w-full max-w-md rounded-tool border border-rule-2 bg-raised p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={t("Update available")}
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon name="download" size={14} className="text-select" />
          {t("Update available")}
        </h2>
        <p className="mt-2 text-[12.5px] leading-snug text-ink-2">
          {t("A new version v{version} is available (you have v{current}).", {
            version: update.latest ?? "",
            current: update.current,
          })}
        </p>

        {state.phase === "downloading" && (
          <p className="mt-2 text-[12.5px] text-ink-2" role="status">
            {state.pct === null ? t("Downloading…") : t("Downloading… {pct}%", { pct: state.pct })}
          </p>
        )}
        {state.phase === "installing" && (
          <p className="mt-2 text-[12.5px] text-ink-2" role="status">
            {t("Installing…")}
          </p>
        )}
        {state.phase === "error" && (
          <p className="mt-2 flex items-start gap-2 text-[12.5px] text-error" role="alert">
            <Icon name="alert" size={13} />
            {t("Update failed: {message}", { message: state.message })}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" className="btn" onClick={onDismiss} disabled={busy}>
            {t("Later")}
          </button>
          {bridge && update.zipUrl ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void install()}>
              {state.phase === "error" ? t("Try again") : t("Update now")}
            </button>
          ) : (
            update.releaseUrl && (
              <a className="btn btn-primary" href={update.releaseUrl} target="_blank" rel="noreferrer">
                {t("Open the download page")}
              </a>
            )
          )}
        </div>
      </div>
    </div>
  );
}
