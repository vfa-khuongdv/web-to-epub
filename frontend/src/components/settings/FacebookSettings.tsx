import { useEffect, useState } from "react";
import { connectFacebook, disconnectFacebook, fetchFacebookStatus } from "../../lib/api";
import { useLang } from "../../i18n";
import { FacebookStatus } from "../../types";

/**
 * Settings → Facebook: the Page id and a Page access token the person made for their own
 * Facebook app. The server checks the token against the Page before keeping it; the app
 * never sees a password and posts only from the story panel after a confirmation.
 */
// The story panel listens for this to reload once the Page is connected or removed.
export const FACEBOOK_CONNECTED = "facebook-connected";

export default function FacebookSettings({ onSaved, onError }: { onSaved: () => void; onError: (m: string) => void }) {
  const { t } = useLang();
  const [status, setStatus] = useState<FacebookStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    fetchFacebookStatus()
      .then(setStatus)
      .catch((err: Error) => {
        setFailed(true);
        onError(err.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setBusy(true);
    try {
      setStatus(await connectFacebook(pageId.trim(), token.trim()));
      setToken("");
      window.dispatchEvent(new Event(FACEBOOK_CONNECTED));
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(t("Disconnect the Facebook Page on this computer?"))) return;
    setBusy(true);
    try {
      await disconnectFacebook();
      setStatus({ connected: false });
      window.dispatchEvent(new Event(FACEBOOK_CONNECTED));
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return <p className="text-[12px] text-ink-3">{failed ? t("Could not load the Facebook settings") : t("Loading…")}</p>;
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px]">
            {status.connected ? t("Connected: {channel}", { channel: status.pageName ?? "" }) : t("Not connected to Facebook yet.")}
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            {t(
              "Posts go to a Page you administer. In developers.facebook.com create an app, grant it publish_video, pages_manage_posts and pages_read_engagement for your Page, and paste the Page id and a long-lived Page access token below. Videos go public right away unless a publish time is set."
            )}
          </p>
        </div>
        {status.connected && (
          <button type="button" className="btn btn-tiny flex-none" disabled={busy} onClick={() => void disconnect()}>
            {t("Disconnect")}
          </button>
        )}
      </div>

      {!status.connected && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
            <div className="text-[13px]">{t("Page id")}</div>
            <input
              className="input w-72 max-w-full"
              aria-label={t("Page id")}
              inputMode="numeric"
              value={pageId}
              disabled={busy}
              onChange={(event) => setPageId(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
            <div className="text-[13px]">{t("Page access token")}</div>
            <input
              className="input w-72 max-w-full"
              type="password"
              autoComplete="off"
              aria-label={t("Page access token")}
              value={token}
              disabled={busy}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn btn-tiny" disabled={busy || !pageId.trim() || !token.trim()} onClick={() => void connect()}>
              {t("Connect Facebook")}
            </button>
          </div>
        </>
      )}
    </>
  );
}
