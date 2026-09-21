import { FormEvent, useEffect, useState } from "react";
import { importSiteSession } from "../lib/api";
import { useLang } from "../i18n";
import { Icon } from "./Icon";

/**
 * Asianfanfics needs a login for rated-M and subscribers-only stories. The tool never
 * sees the password and never solves a bot check: the reader logs in with their own
 * browser and pastes a cURL copy of a request from it — the server keeps the cookies.
 *
 * Shown from the add-story flow (before loading an Asianfanfics URL, when no session is
 * saved) and from Settings (to replace or import one). Skipping is always allowed:
 * public stories crawl fine as a guest.
 */
export default function SiteSessionDialog({
  onSaved,
  onSkip,
}: {
  onSaved: () => void;
  onSkip: () => void;
}) {
  const { t } = useLang();
  const [curl, setCurl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSkip]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await importSiteSession(curl);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onSkip()}
    >
      <form
        className="max-h-full w-full max-w-xl overflow-y-auto rounded-tool border border-rule-2 bg-raised p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={t("Asianfanfics session")}
        onSubmit={handleSubmit}
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon name="lock" size={14} />
          {t("Asianfanfics session")}
        </h2>
        <p className="mt-2 text-[12.5px] leading-snug text-ink-2">
          {t(
            "Rated-M and subscribers-only stories need a login saved from your own browser. The tool never sees your password — you log in there and paste a copy of the request."
          )}
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12.5px] leading-snug text-ink-2">
          <li>{t("Log in at asianfanfics.com in your browser.")}</li>
          <li>{t("Open DevTools → Network and reload the page.")}</li>
          <li>{t("Right-click the first request → Copy → Copy as cURL.")}</li>
          <li>{t("Paste the result below.")}</li>
        </ol>
        <p className="mt-2 text-[11.5px] text-ink-3">
          {t("The saved login lasts about an hour; import a fresh one when it expires.")}
        </p>

        <label className="mt-4 block text-[12.5px] font-medium" htmlFor="site-session-curl">
          {t("cURL from your browser")}
        </label>
        <textarea
          id="site-session-curl"
          className="input mt-1 min-h-28 w-full font-mono text-[11.5px]"
          placeholder="curl 'https://www.asianfanfics.com/story/view/123' -H 'cookie: ...'"
          value={curl}
          onChange={(event) => setCurl(event.target.value)}
          disabled={busy}
        />

        {error && (
          <p className="mt-2 flex items-start gap-2 text-[12.5px] text-error" role="alert">
            <Icon name="alert" size={13} />
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="mr-auto text-[11.5px] text-ink-3">{t("You can skip this — public stories still load.")}</span>
          <button type="button" className="btn" onClick={onSkip} disabled={busy}>
            {t("Skip")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || curl.trim().length === 0}>
            {busy ? t("Saving…") : t("Save session")}
          </button>
        </div>
      </form>
    </div>
  );
}
