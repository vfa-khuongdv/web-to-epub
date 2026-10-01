import { apiFetch, langHeaders, readJsonError, tr } from "./http";

export interface SiteSessionStatus {
  configured: boolean;
  // When the session was imported, when its login token stops working (from the token
  // itself), and the account it belongs to — the settings page shows all three so a
  // stale or wrong-account session is noticed before a crawl starts failing.
  savedAt?: string;
  expiresAt?: string;
  username?: string;
}

// `site` is a slug from lib/siteSessions.ts; the server maps it to the site's domain.
export async function fetchSiteSession(site: string): Promise<SiteSessionStatus> {
  const res = await apiFetch(`/api/site-sessions/${encodeURIComponent(site)}`, { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not check the saved session")));
  return (await res.json()) as SiteSessionStatus;
}

// The body is a cURL copy of a request from the user's own browser; the server
// keeps the cookies and answers only how many it saved.
export async function importSiteSession(site: string, curl: string): Promise<{ cookieCount: number; username?: string }> {
  const res = await apiFetch(`/api/site-sessions/${encodeURIComponent(site)}`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ curl }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save the session")));
  return (await res.json()) as { cookieCount: number; username?: string };
}

export async function removeSiteSession(site: string): Promise<void> {
  const res = await apiFetch(`/api/site-sessions/${encodeURIComponent(site)}`, {
    method: "DELETE",
    headers: langHeaders(),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not remove the session")));
}
