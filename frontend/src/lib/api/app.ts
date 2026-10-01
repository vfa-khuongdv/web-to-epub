import { AppInfo, AppSettings, AppUpdateInfo } from "../../types";
import { apiFetch, langHeaders, readJsonError, tr } from "./http";

// One request: the values the page can change, plus the read-only facts it shows.
export async function fetchSettings(): Promise<{ settings: AppSettings; app: AppInfo }> {
  const res = await apiFetch("/api/settings", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load settings")));
  return (await res.json()) as { settings: AppSettings; app: AppInfo };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const res = await apiFetch("/api/settings", {
    method: "PATCH",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save settings")));
  return ((await res.json()) as { settings: AppSettings }).settings;
}

export async function fetchAppUpdate(): Promise<AppUpdateInfo> {
  const res = await apiFetch("/api/app-update", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not check for updates")));
  return (await res.json()) as AppUpdateInfo;
}
