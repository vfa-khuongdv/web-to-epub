# Design: App auto-update (macOS, no Apple account)

Date: 2026-09-23
Status: Awaiting spec review

## 1. Objectives

1. **Detect**: on app open, check GitHub Releases for a newer version and show an
   in-app banner ("A new version vX.Y.Z is available").
2. **Install (macOS app only)**: one click downloads the release ZIP, replaces the
   running `.app` bundle, and relaunches — **without an Apple Developer account**
   (ad-hoc signing stays as is).
3. **Web/Docker**: the same banner, but only a link to the release page; updating is
   `docker pull` / manual download.

Out of scope (non-goals):

- No Windows/Linux auto-install, no Docker self-update.
- No code signing/notarization; no Squirrel.Mac/`electron-updater` (they require a
  Developer ID; Electron docs: "Squirrel.Mac requires the app to be signed for
  automatic updates to work at all").
- No hash/signature verification beyond HTTPS to GitHub (see §7).
- No background polling, no scheduled checks: one check per app open.
- No "Check for updates" button in Settings — the banner is the whole UI.

## 2. Current Context

- `APP_VERSION` is read from `package.json` (`src/config/appInfo.ts`) and shown in
  Settings (`app.version` from `src/routes/settings.ts`).
- Releases live on GitHub `vfa-khuongdv/web-to-epub`; `make release-mac`
  (Makefile:70) builds DMG + ZIP via electron-builder but uploads **only the DMG**.
  The ZIP (`release/Web to EPUB-X.Y.Z-arm64-mac.zip`, `"target": ["dmg","zip"]`
  in package.json:62) and `latest-mac.yml` stay local today.
- Electron shell (`electron/main.js`): starts `dist/server.js` in-process, sets
  `DATA_DIR` to userData, has `isPackaged`; `before-quit` closes the Playwright
  Chromium through `dist/services/renderer.js` (the precedent for requiring
  compiled `dist/` modules from the main process).
- `electron/preload.js` exposes `window.electronExport` via `contextBridge` — the
  pattern for a new bridge; frontend type declarations live in
  `frontend/src/types/file-system-access.d.ts`.
- Signing: `mac.identity: null` + `scripts/adhoc-sign.js` (afterPack) — ad-hoc only.
- CI unit tests run on **Ubuntu** (`.github/workflows/ci.yml`), so installer tests
  must not call macOS-only tools (`ditto`, `xattr`).
- i18n: keys are the English source strings; `i18n/locales.test.ts` enforces key and
  placeholder parity between `en.ts` and `vi.ts`.

## 3. Design

### 3.1 Server — version check

`src/config/update.ts`:

```ts
export const UPDATE_REPO = "vfa-khuongdv/web-to-epub";
```

`src/services/appUpdate.ts` (factory + singleton, `settingsStore` pattern):

```ts
// -1 | 0 | 1; strips a leading "v"; compares numeric segments; non-numeric suffixes ignored.
export function compareVersions(a: string, b: string): number;

// GitHub mangles spaces to dots: "Web.to.EPUB-1.6.0-arm64-mac.zip".
export function pickZipAsset(
  assets: { name: string; browser_download_url: string }[],
  version: string
): string | null;

export interface UpdateStatus {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  zipUrl: string | null;
}

export function createAppUpdateChecker(deps?: { fetchImpl?: typeof fetch; now?: () => number }): {
  check(current: string): Promise<UpdateStatus>;
};
export const appUpdateChecker = createAppUpdateChecker();
```

- Request: `GET https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
  with `Accept: application/vnd.github+json` (unauthenticated; 60 req/h per IP is
  plenty for one check per app open).
- `latest` = `tag_name` without the leading `v`; `releaseUrl` = `html_url`;
  `zipUrl` = the asset matching `/-arm64-mac\.zip$/` whose name contains the
  version, else any matching asset, else `null`.
- `hasUpdate = compareVersions(latest, current) > 0`.
- Cache in module state: success cached 6 h, failure (HTTP/network/parse) cached
  15 min as "no update". Any error returns
  `{ current, latest: null, hasUpdate: false, releaseUrl: null, zipUrl: null }` —
  the check is silent and never surfaces an error to the reader.
- Route: `GET /api/app-update` in a new `src/routes/appUpdate.ts`, registered in
  `src/routes/index.ts`. App-level, not library-level: no `libraryFor`, and the
  banner shows in private mode too.

### 3.2 macOS install (Electron main)

`src/services/appInstaller.ts` — plain Node (no Electron imports), compiled to
`dist/services/appInstaller.js` and required by the main process (same as
`renderer.js` today), so the logic is unit-testable:

```ts
// ".../Web to EPUB.app/Contents/MacOS/Web to EPUB" -> ".../Web to EPUB.app"
export function resolveAppBundlePath(execPath: string): string;

// .app at the root or one level deep; prefers the product name when several match.
export function findAppBundleInDir(dir: string): string | null;

export interface InstallOptions {
  zipPath: string;
  appBundlePath: string;
  // Injected in tests so CI (Ubuntu) never calls ditto/xattr.
  run?: (cmd: string, args: string[]) => Promise<void>;
  rename?: (from: string, to: string) => void;
}
export async function installUpdateFromZip(opts: InstallOptions): Promise<void>;

// Best-effort at startup: remove "<app>.old" and stale ".web-to-epub-update-*" siblings.
export function cleanupUpdateLeftovers(appBundlePath: string): void;
```

Install steps:

1. Make a temp dir **next to the app bundle**:
   `<parent>/.web-to-epub-update-<rand>`. Same volume is required for the later
   renames (a `/tmp` extract would be a cross-device move), and the parent is
   already writable whenever the app itself can be replaced.
2. `ditto -x -k <zip> <tmp>` (preserves symlinks, permissions, signature).
3. `findAppBundleInDir(tmp)`; no `.app` → error, nothing touched.
4. Remove any stale `<app>.old` left by an earlier failed cleanup (best-effort),
   then rename `<app>` → `<app>.old`. EACCES/EPERM/EROFS (app running from the DMG
   via App Translocation, root-owned `/Applications`, read-only volume) → abort
   with a clear "move the app to Applications / download manually" error; nothing
   changed.
5. Rename the new `.app` → `<app>`; on failure rename `.old` back (rollback) and
   rethrow.
6. `xattr -cr <app>` (drop any quarantine) and `touch` the bundle
   (LaunchServices refresh). Failure here is non-fatal.
7. Remove the temp dir. `.old` is removed by `cleanupUpdateLeftovers` on next launch.

`electron/main.js`:

- IPC `update:install` (`ipcMain.handle`) + `update:progress` (webContents.send):
  - Guard `app.isPackaged`, reject concurrent installs (module flag).
  - Validate `zipUrl` host ∈ `github.com` / `objects.githubusercontent.com`
    before downloading.
  - Download with global `fetch` streamed to a temp file, sending
    `{ received, total }` progress (total may be 0 if the header is missing).
  - `installUpdateFromZip(...)`, then `app.relaunch(); app.quit();` — the existing
    `before-quit` handler closes Chromium first, then the new instance starts from
    the replaced bundle (same path, new contents).
  - Errors are thrown back to the renderer; the banner shows the message.
- On startup (packaged only): `cleanupUpdateLeftovers(resolveAppBundlePath(process.execPath))`.

`electron/preload.js`: expose

```js
contextBridge.exposeInMainWorld("electronUpdate", {
  install: (zipUrl) => ipcRenderer.invoke("update:install", zipUrl),
  onProgress: (cb) => { /* ipcRenderer.on + unsubscribe */ },
});
```

### 3.3 Frontend

- `frontend/src/types/electron-update.d.ts` (new): declares the optional
  `window.electronUpdate` bridge, mirroring `file-system-access.d.ts`.
- `frontend/src/types.ts`: `AppUpdateInfo` (`current`, `latest`, `hasUpdate`,
  `releaseUrl`, `zipUrl`).
- `frontend/src/lib/api.ts`: `fetchAppUpdate()`.
- `frontend/src/App.tsx`: one fire-and-forget `fetchAppUpdate()` on mount (errors
  swallowed); holds `update` + `dismissed` state and renders `UpdateBanner`.
- `frontend/src/components/UpdateBanner.tsx` (new), under the header:
  - "A new version v{latest} is available (you have v{current})."
  - Electron and `zipUrl` present → button **"Update now"**: calls
    `electronUpdate.install(zipUrl)`, subscribes to progress, shows
    "Downloading… {pct}%" (plain "Downloading…" while `total` is unknown) then
    "Installing…"; on error
    "Update failed: {message}" + "Try again".
  - Otherwise (web/Docker, or no zip asset) → link **"Open the download page"**
    to `releaseUrl` (`target="_blank"`; the Electron window handler already opens
    external links in the default browser).
  - "×" dismiss hides it until the next app open (component state only, no
    persistence).
- i18n: new keys added to `en.ts` and `vi.ts` (parity test enforces both).

### 3.4 Release flow

- `Makefile release-mac`: also upload
  `release/Web to EPUB-$(VERSION)-arm64-mac.zip` to the release (`--clobber`).
- `RELEASE.md`: step 5 and the verify step mention both artifacts; note GitHub
  stores the ZIP as `Web.to.EPUB-X.Y.Z-arm64-mac.zip`.
- `README.md`: Features (auto-update banner + one-click macOS update) and Known
  Limitations (see §7).

## 4. Testing & verification

Unit tests (vitest, hermetic, no network, run on Ubuntu):

- `src/services/appUpdate.test.ts`:
  - `compareVersions`: equal, newer, older, `v` prefix, shorter (`1.5` vs `1.5.0`),
    garbage/non-numeric segments.
  - `pickZipAsset`: dot-mangled name, wrong-version asset, no zip asset.
  - `createAppUpdateChecker` with injected `fetchImpl` + `now`: update available,
    up to date, missing zip asset, HTTP 500, network throw, parse error; success
    cached for 6 h; failure negative-cached 15 min and retried after.
- `src/services/appInstaller.test.ts` (tmp dirs; fake `run`, injected `rename`):
  - `resolveAppBundlePath` / `findAppBundleInDir` (root, nested, none, preference).
  - Successful install: old bundle renamed to `.old`, new one in place, `xattr`
    invoked, temp dir removed.
  - No `.app` in the archive → error, app untouched.
  - Old-bundle rename fails (simulated EACCES) → error, nothing changed.
  - New-bundle rename fails → rollback restores the old bundle and rethrows.
  - `cleanupUpdateLeftovers` removes `.old` and stale temp siblings, tolerates
    their absence.
- `i18n/locales.test.ts` picks up the new keys automatically.

Manual verification:

1. `make app`, install; bump the version, create a release with DMG + ZIP assets;
   open the installed (older) app → banner appears; "Update now" → progress → app
   relaunches on the new version with no Gatekeeper prompt.
2. Truncate/corrupt the ZIP asset → install fails, old app still runs, banner
   shows the error with "Try again".
3. Run the app straight from the mounted DMG → error asks the user to move it to
   Applications.
4. `npm start` in a browser (web/Docker) → banner with the download-page link only.
5. `npm test`, `npx tsc -p frontend --noEmit`, `npx tsc -p e2e --noEmit`,
   `npm run build` all pass.

## 5. Affected Components

- New: `src/config/update.ts`, `src/services/appUpdate.ts` (+ `.test.ts`),
  `src/services/appInstaller.ts` (+ `.test.ts`), `src/routes/appUpdate.ts`,
  `frontend/src/components/UpdateBanner.tsx`,
  `frontend/src/types/electron-update.d.ts`.
- Changed: `src/routes/index.ts`, `frontend/src/App.tsx`,
  `frontend/src/types.ts`, `frontend/src/lib/api.ts`,
  `frontend/src/i18n/locales/{en,vi}.ts`, `electron/main.js`,
  `electron/preload.js`, `Makefile`, `RELEASE.md`, `README.md`.

## 6. Success Criteria

- A newer GitHub release → the banner appears once per app open with the correct
  versions; no update → nothing shows; check failures → nothing shows.
- macOS app: one click downloads (progress shown), swaps the bundle, relaunches on
  the new version; every failure path leaves the installed app runnable and
  reports a clear message.
- Web/Docker: banner links to the release page; no install attempt.
- `npm test`, both typechecks and the build pass; CI stays green on Ubuntu.

## 7. Known Limitations / Accepted Risks (document in README)

- **No signature/hash verification**: trust is HTTPS to github.com plus our own
  repository — the same trust as downloading the DMG by hand. A hash shipped in
  the same release would not add security.
- **Quarantine is stripped by us** (`xattr -cr`) because the app is ad-hoc signed;
  macOS may tighten this in a future release. The banner's manual download link is
  the fallback if self-install ever stops working.
- **Writable location required**: DMG-translocated or root-owned installs get an
  error instead of an update.
- **macOS arm64 only** for auto-install; Docker/Linux/Windows users update
  manually (`docker pull`, DMG download).
- **Once per app open, no polling**: a release published while the app is open is
  only noticed after a restart.
- The 226 MB ZIP is downloaded in full (no delta updates).
