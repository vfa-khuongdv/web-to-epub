import { useEffect, useState } from "react";
import { useLang } from "../i18n";
import { AppUpdateInfo } from "../types";
import { Icon } from "./Icon";

type InstallState =
  | { phase: "idle" }
  | { phase: "downloading"; pct: number | null }
  | { phase: "installing" }
  | { phase: "error"; message: string };

// A new release was found when the app opened. Inside the packaged app the button
// downloads the zip, the app replaces itself and restarts (electron/main.js);
// anywhere else it is a link to the release page.
export function UpdateBanner({ update, onDismiss }: { update: AppUpdateInfo; onDismiss: () => void }) {
  const { t } = useLang();
  const [state, setState] = useState<InstallState>({ phase: "idle" });
  const bridge = window.electronUpdate;

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

  async function install() {
    if (!bridge || !update.zipUrl) return;
    setState({ phase: "downloading", pct: null });
    try {
      await bridge.install(update.zipUrl);
    } catch (err) {
      setState({ phase: "error", message: (err as Error).message });
    }
  }

  const busy = state.phase === "downloading" || state.phase === "installing";

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b border-rule-2 bg-raised px-3.5 py-1.5 text-[12.5px]"
    >
      <Icon name="download" size={13} className="shrink-0 text-select" />
      <span>
        {t("A new version v{version} is available (you have v{current}).", {
          version: update.latest ?? "",
          current: update.current,
        })}
      </span>

      {state.phase === "downloading" && (
        <span className="text-ink-2">
          {state.pct === null ? t("Downloading…") : t("Downloading… {pct}%", { pct: state.pct })}
        </span>
      )}
      {state.phase === "installing" && <span className="text-ink-2">{t("Installing…")}</span>}
      {state.phase === "error" && (
        <span className="text-error">{t("Update failed: {message}", { message: state.message })}</span>
      )}

      <span className="ml-auto flex items-center gap-2">
        {bridge && update.zipUrl ? (
          <button type="button" className="btn btn-tiny" disabled={busy} onClick={() => void install()}>
            <Icon name="download" size={12} />
            {state.phase === "error" ? t("Try again") : t("Update now")}
          </button>
        ) : (
          update.releaseUrl && (
            <a className="btn btn-tiny" href={update.releaseUrl} target="_blank" rel="noreferrer">
              {t("Open the download page")}
            </a>
          )
        )}
        <button type="button" className="btn btn-quiet btn-tiny" aria-label={t("Close")} onClick={onDismiss}>
          <Icon name="x" size={12} />
        </button>
      </span>
    </div>
  );
}
