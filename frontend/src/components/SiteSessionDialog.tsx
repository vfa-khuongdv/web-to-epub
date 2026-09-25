import { FormEvent, useEffect, useState } from "react";
import { importSiteSession } from "../lib/api";
import { SessionSite } from "../lib/siteSessions";
import { useLang } from "../i18n";
import { Icon } from "./Icon";

/**
 * The tool never sees the password and never solves a bot check: the reader gets the
 * session in their own browser (a login for Asianfanfics, the Cloudflare pass for
 * TruyenFull) and pastes a cURL copy of a request from it — the server keeps the cookies.
 *
 * Shown from the add-story flow (before loading a URL from a site that needs a session)
 * and from Settings (to replace or import one). Skipping is always allowed.
 */
export default function SiteSessionDialog({
  site,
  onSaved,
  onSkip,
}: {
  site: SessionSite;
  // The account the saved token belongs to, when the token names one.
  onSaved: (result: { username?: string }) => void;
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
      const result = await importSiteSession(site.slug, curl);
      onSaved(result);
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
        aria-label={t(site.dialogTitle)}
        onSubmit={handleSubmit}
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon name="lock" size={14} />
          {t(site.dialogTitle)}
        </h2>
        <p className="mt-2 text-[12.5px] leading-snug text-ink-2">{t(site.dialogIntro)}</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12.5px] leading-snug text-ink-2">
          {site.dialogSteps.map((step) => (
            <li key={step}>{t(step)}</li>
          ))}
        </ol>
        <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
          {site.dialogNotes.map((note) => t(note)).join(" ")}
        </p>

        <label className="mt-4 block text-[12.5px] font-medium" htmlFor="site-session-curl">
          {t("cURL from your browser")}
        </label>
        <textarea
          id="site-session-curl"
          className="input mt-1 min-h-28 w-full font-mono text-[11.5px]"
          placeholder={site.placeholder}
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
          <span className="mr-auto text-[11.5px] text-ink-3">{t(site.skipNote)}</span>
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
