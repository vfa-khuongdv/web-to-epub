import { Router } from "express";
import { t } from "../services/lang";
import { parseSessionCurl, removeSiteSession, saveSiteSession, siteSessionStatus } from "../services/siteSession";

export const siteSessionsRouter = Router();

// The one site that needs a saved login: Cloudflare-protected, with rated-M and
// subscribers-only stories behind an account. Kept as fixed paths rather than a
// :domain parameter so no request can name a file to write.
const SITE_DOMAIN = "asianfanfics.com";

siteSessionsRouter.get("/site-sessions/asianfanfics", (_req, res) => {
  res.json(siteSessionStatus(SITE_DOMAIN));
});

// The body is a cURL copy of a request from the user's own logged-in browser. It carries
// the account's cookies, so nothing here logs or echoes it back — the response reports
// only how many cookies were kept.
siteSessionsRouter.post("/site-sessions/asianfanfics", (req, res) => {
  const curl = (req.body as { curl?: unknown } | undefined)?.curl;
  if (typeof curl !== "string" || curl.trim().length === 0) {
    res.status(400).json({ message: t("Paste the cURL copy from your browser first") });
    return;
  }

  let parsed;
  try {
    parsed = parseSessionCurl(curl, SITE_DOMAIN);
  } catch (err) {
    res.status(400).json({ message: err instanceof Error ? err.message : String(err) });
    return;
  }

  try {
    saveSiteSession(SITE_DOMAIN, { userAgent: parsed.userAgent, cookies: parsed.cookies, origins: [] });
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    return;
  }
  res.json({ cookieCount: parsed.cookies.length });
});

siteSessionsRouter.delete("/site-sessions/asianfanfics", (_req, res) => {
  res.json({ removed: removeSiteSession(SITE_DOMAIN) });
});
