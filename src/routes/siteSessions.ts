import { createRouter } from "./asyncRouter";
import { t } from "../services/lang";
import { SESSION_SITES } from "../sites";
import {
  parseSessionCurl,
  removeSiteSession,
  saveSiteSession,
  sessionAccountName,
  siteSessionStatus,
} from "../services/siteSession";

export const siteSessionsRouter = createRouter();

// Which sites keep a session is declared by each site (src/sites/<id>/index.ts).

siteSessionsRouter.get("/site-sessions/:site", (req, res) => {
  const domain = SESSION_SITES[req.params.site];
  if (!domain) {
    res.status(404).json({ message: t("Unknown site session") });
    return;
  }
  res.json(siteSessionStatus(domain));
});

// The body is a cURL copy of a request from the user's own browser. It carries
// the account's cookies, so nothing here logs or echoes it back — the response reports
// only how many cookies were kept.
siteSessionsRouter.post("/site-sessions/:site", (req, res) => {
  const domain = SESSION_SITES[req.params.site];
  if (!domain) {
    res.status(404).json({ message: t("Unknown site session") });
    return;
  }
  const curl = (req.body as { curl?: unknown } | undefined)?.curl;
  if (typeof curl !== "string" || curl.trim().length === 0) {
    res.status(400).json({ message: t("Paste the cURL copy from your browser first") });
    return;
  }

  let parsed;
  try {
    parsed = parseSessionCurl(curl, domain);
  } catch (err) {
    res.status(400).json({ message: err instanceof Error ? err.message : String(err) });
    return;
  }

  try {
    const session = { userAgent: parsed.userAgent, cookies: parsed.cookies, origins: [] };
    saveSiteSession(domain, session);
    // Report the account the token belongs to, so the UI can show whose login this is.
    res.json({ cookieCount: parsed.cookies.length, username: sessionAccountName(session) });
    return;
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    return;
  }
});

siteSessionsRouter.delete("/site-sessions/:site", (req, res) => {
  const domain = SESSION_SITES[req.params.site];
  if (!domain) {
    res.status(404).json({ message: t("Unknown site session") });
    return;
  }
  res.json({ removed: removeSiteSession(domain) });
});
