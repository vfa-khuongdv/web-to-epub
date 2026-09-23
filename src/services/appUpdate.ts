/**
 * Is there a newer release than this build?
 *
 * The check is best-effort and silent: offline, GitHub down or rate-limited all read
 * as "no update" — a background check the reader did not ask for must not produce an
 * error. Results are cached in module state; one request per app open is plenty, and
 * a long-running Docker container does not hammer the API.
 */
import { UPDATE_REPO } from "../config/update";

const API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 15 * 60 * 1000;

export interface UpdateStatus {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  zipUrl: string | null;
}

// Numeric-segment comparison. A leading "v" and non-numeric suffixes ("-beta.1") are
// ignored: /releases/latest never returns a prerelease, and a dev build should not
// read as older than a release.
export function compareVersions(a: string, b: string): number {
  const segments = (value: string) =>
    value.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = segments(a);
  const right = segments(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export interface GithubAsset {
  name: string;
  browser_download_url: string;
}

// GitHub replaces spaces in asset names with dots, so the macOS zip is named
// "Web.to.EPUB-1.6.0-arm64-mac.zip". Prefer the asset naming the release version;
// fall back to any arm64 zip so a renamed build still updates.
export function pickZipAsset(assets: GithubAsset[], version: string): string | null {
  const zips = assets.filter((asset) => /-arm64-mac\.zip$/.test(asset.name));
  const match = zips.find((asset) => asset.name.includes(version)) ?? zips[0];
  return match?.browser_download_url ?? null;
}

export interface AppUpdateChecker {
  check(current: string): Promise<UpdateStatus>;
}

export function createAppUpdateChecker(
  deps: { fetchImpl?: typeof fetch; now?: () => number } = {}
): AppUpdateChecker {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  let cached: { at: number; status: UpdateStatus } | null = null;
  let failedAt: number | null = null;

  return {
    async check(current: string): Promise<UpdateStatus> {
      const noUpdate: UpdateStatus = {
        current,
        latest: null,
        hasUpdate: false,
        releaseUrl: null,
        zipUrl: null,
      };
      const at = now();
      if (cached && at - cached.at < SUCCESS_TTL_MS) return { ...cached.status, current };
      if (failedAt !== null && at - failedAt < FAILURE_TTL_MS) return noUpdate;

      try {
        const res = await fetchImpl(API_URL, { headers: { Accept: "application/vnd.github+json" } });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const release = (await res.json()) as {
          tag_name?: unknown;
          html_url?: unknown;
          assets?: unknown;
        };
        if (typeof release.tag_name !== "string" || typeof release.html_url !== "string") {
          throw new Error("Unexpected release shape");
        }
        const latest = release.tag_name.replace(/^v/, "");
        const status: UpdateStatus = {
          current,
          latest,
          hasUpdate: compareVersions(latest, current) > 0,
          releaseUrl: release.html_url,
          zipUrl: pickZipAsset(Array.isArray(release.assets) ? (release.assets as GithubAsset[]) : [], latest),
        };
        cached = { at, status };
        failedAt = null;
        return status;
      } catch {
        failedAt = at;
        return noUpdate;
      }
    },
  };
}

export const appUpdateChecker = createAppUpdateChecker();
