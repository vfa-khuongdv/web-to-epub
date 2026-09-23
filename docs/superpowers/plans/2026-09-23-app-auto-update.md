# App Auto-update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The macOS app checks GitHub Releases on open and, when a newer version exists, shows a banner whose button downloads the release zip, swaps the running `.app`, and relaunches — no Apple Developer account. Web/Docker gets the same banner with a link to the release page.

**Architecture:** A server-side check (`services/appUpdate.ts` → `GET /api/app-update`, silent on failure, cached) feeds a React banner. Inside the packaged Electron app the banner calls an IPC bridge; the main process downloads the zip and `services/appInstaller.ts` (plain Node, unit-tested) extracts it, renames the old bundle to `<app>.old`, moves the new one in, clears quarantine, and the app relaunches. Every failure path restores the old bundle.

**Tech Stack:** TypeScript (CommonJS backend), Express, React 18 + Vite + Tailwind 4, Electron 44 (plain-JS main/preload), vitest, Node ≥ 22.5. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-app-auto-update-design.md`

## Global Constraints

- No new runtime dependencies; semver comparison is hand-written.
- Unit tests run on Ubuntu CI (`.github/workflows/ci.yml`) — installer tests must inject `run`/`rename`, never call `ditto`/`xattr`.
- `npm test`, `npx tsc -p frontend --noEmit`, `npx tsc -p e2e --noEmit`, `npm run build` must pass at the end of every task.
- i18n keys are the English source text; `en.ts` and `vi.ts` must stay key- and placeholder-identical (`frontend/src/i18n/locales.test.ts` enforces it).
- Tailwind utilities at the call site only; never add component classes to `styles.css`; never hand-edit `public/` or `dist/`.
- Auto-install is macOS-arm64-only and runs only when `app.isPackaged`; web/Docker always falls back to the release link.
- Commit messages: conventional prefixes, Vietnamese or English (repo style).

---

### Task 1: Version comparison + GitHub release check

**Files:**
- Create: `src/config/update.ts`
- Create: `src/services/appUpdate.ts`
- Test: `src/services/appUpdate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `UPDATE_REPO: string` (`src/config/update.ts`)
  - `compareVersions(a: string, b: string): number`
  - `pickZipAsset(assets: GithubAsset[], version: string): string | null`
  - `interface UpdateStatus { current: string; latest: string | null; hasUpdate: boolean; releaseUrl: string | null; zipUrl: string | null }`
  - `createAppUpdateChecker(deps?: { fetchImpl?: typeof fetch; now?: () => number }): { check(current: string): Promise<UpdateStatus> }`
  - `appUpdateChecker` singleton

- [ ] **Step 1: Write the failing tests**

Create `src/services/appUpdate.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { compareVersions, createAppUpdateChecker, pickZipAsset } from "./appUpdate";

const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: "v1.6.0",
  html_url: "https://github.com/vfa-khuongdv/web-to-epub/releases/tag/v1.6.0",
  assets: [
    { name: "Web.to.EPUB-1.6.0-arm64.dmg", browser_download_url: "https://github.com/dl/x.dmg" },
    { name: "Web.to.EPUB-1.6.0-arm64-mac.zip", browser_download_url: "https://github.com/dl/x.zip" },
  ],
  ...overrides,
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("compareVersions", () => {
  it("orders numeric segments", () => {
    expect(compareVersions("1.6.0", "1.5.1")).toBe(1);
    expect(compareVersions("1.5.1", "1.6.0")).toBe(-1);
    expect(compareVersions("1.5.1", "1.5.1")).toBe(0);
  });

  it("ignores a leading v and a prerelease suffix", () => {
    expect(compareVersions("v1.5.1", "1.5.1")).toBe(0);
    expect(compareVersions("1.6.0-beta.1", "1.5.1")).toBe(1);
  });

  it("treats missing segments as zero", () => {
    expect(compareVersions("1.5", "1.5.0")).toBe(0);
  });

  it("treats garbage as zero", () => {
    expect(compareVersions("unknown", "0.0.0")).toBe(0);
  });
});

describe("pickZipAsset", () => {
  it("picks the dot-mangled arm64 zip", () => {
    expect(pickZipAsset(release().assets, "1.6.0")).toBe("https://github.com/dl/x.zip");
  });

  it("prefers the asset naming the version", () => {
    const assets = [
      { name: "Web.to.EPUB-1.5.0-arm64-mac.zip", browser_download_url: "https://github.com/dl/old.zip" },
      { name: "Web.to.EPUB-1.6.0-arm64-mac.zip", browser_download_url: "https://github.com/dl/new.zip" },
    ];
    expect(pickZipAsset(assets, "1.6.0")).toBe("https://github.com/dl/new.zip");
  });

  it("returns null when the release has no mac zip", () => {
    const assets = [{ name: "Web.to.EPUB-1.6.0-arm64.dmg", browser_download_url: "https://github.com/dl/x.dmg" }];
    expect(pickZipAsset(assets, "1.6.0")).toBeNull();
  });
});

describe("createAppUpdateChecker", () => {
  it("reports an update with the release and zip urls", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(release()));
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toEqual({
      current: "1.5.1",
      latest: "1.6.0",
      hasUpdate: true,
      releaseUrl: "https://github.com/vfa-khuongdv/web-to-epub/releases/tag/v1.6.0",
      zipUrl: "https://github.com/dl/x.zip",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reports no update when the latest release is the current version", async () => {
    const fetchImpl = async () => jsonResponse(release({ tag_name: "v1.5.1" }));
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toMatchObject({ latest: "1.5.1", hasUpdate: false });
  });

  it("reports an update without a zip url when the release has no mac zip", async () => {
    const fetchImpl = async () =>
      jsonResponse(release({ assets: [{ name: "Web.to.EPUB-1.6.0-arm64.dmg", browser_download_url: "https://github.com/dl/x.dmg" }] }));
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const status = await checker.check("1.5.1");
    expect(status.hasUpdate).toBe(true);
    expect(status.zipUrl).toBeNull();
  });

  it("stays silent when GitHub answers an error", async () => {
    const fetchImpl = async () => jsonResponse({}, false, 500);
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toEqual({
      current: "1.5.1",
      latest: null,
      hasUpdate: false,
      releaseUrl: null,
      zipUrl: null,
    });
  });

  it("stays silent when the network throws", async () => {
    const fetchImpl = async () => {
      throw new Error("offline");
    };
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toMatchObject({ hasUpdate: false, latest: null });
  });

  it("stays silent on an unexpected payload", async () => {
    const fetchImpl = async () => jsonResponse({ message: "Not Found" });
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(checker.check("1.5.1")).resolves.toMatchObject({ hasUpdate: false, latest: null });
  });

  it("caches a successful check for six hours", async () => {
    let nowMs = 1_000_000;
    const fetchImpl = vi.fn(async () => jsonResponse(release()));
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => nowMs });
    await checker.check("1.5.1");
    nowMs += 5 * 60 * 60 * 1000;
    await checker.check("1.5.1");
    expect(fetchImpl).toHaveBeenCalledOnce();
    nowMs += 2 * 60 * 60 * 1000;
    await checker.check("1.5.1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("negative-caches a failure for fifteen minutes", async () => {
    let nowMs = 1_000_000;
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const checker = createAppUpdateChecker({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => nowMs });
    await checker.check("1.5.1");
    nowMs += 10 * 60 * 1000;
    await checker.check("1.5.1");
    expect(fetchImpl).toHaveBeenCalledOnce();
    nowMs += 10 * 60 * 1000;
    await checker.check("1.5.1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/appUpdate.test.ts`
Expected: FAIL — `Cannot find module './appUpdate'`.

- [ ] **Step 3: Write the config constant**

Create `src/config/update.ts`:

```ts
/**
 * Where released builds live. services/appUpdate.ts asks GitHub for the latest
 * release of this repository; the macOS app downloads the zip asset from it.
 */
export const UPDATE_REPO = "vfa-khuongdv/web-to-epub";
```

- [ ] **Step 4: Write the service**

Create `src/services/appUpdate.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/services/appUpdate.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/config/update.ts src/services/appUpdate.ts src/services/appUpdate.test.ts
git commit -m "feat(update): kiểm tra bản mới trên GitHub Releases"
```

---

### Task 2: Expose the check over HTTP

**Files:**
- Create: `src/routes/appUpdate.ts`
- Create: `src/routes/appUpdate.test.ts`
- Modify: `src/routes/index.ts`

**Interfaces:**
- Consumes: `appUpdateChecker.check(current)` from Task 1; `APP_VERSION` from `src/config/appInfo.ts`.
- Produces: `GET /api/app-update` → `UpdateStatus` JSON; `appUpdateRouter` (Express Router).

- [ ] **Step 1: Write the failing route test**

Create `src/routes/appUpdate.test.ts`:

```ts
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../services/appUpdate", () => ({
  appUpdateChecker: {
    check: vi.fn(async (current: string) => ({
      current,
      latest: "1.6.0",
      hasUpdate: true,
      releaseUrl: "https://github.com/vfa-khuongdv/web-to-epub/releases/tag/v1.6.0",
      zipUrl:
        "https://github.com/vfa-khuongdv/web-to-epub/releases/download/v1.6.0/Web.to.EPUB-1.6.0-arm64-mac.zip",
    })),
  },
}));

describe("app update route", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const express = (await import("express")).default;
    const { appUpdateRouter } = await import("./appUpdate");
    const app = express();
    app.use("/api", appUpdateRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("expected a TCP address");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("answers the update status for this build", async () => {
    const res = await fetch(`${base}/api/app-update`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      current: expect.any(String),
      latest: "1.6.0",
      hasUpdate: true,
      releaseUrl: "https://github.com/vfa-khuongdv/web-to-epub/releases/tag/v1.6.0",
      zipUrl:
        "https://github.com/vfa-khuongdv/web-to-epub/releases/download/v1.6.0/Web.to.EPUB-1.6.0-arm64-mac.zip",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/appUpdate.test.ts`
Expected: FAIL — `Cannot find module './appUpdate'`.

- [ ] **Step 3: Write the route and register it**

Create `src/routes/appUpdate.ts`:

```ts
import { Router } from "express";
import { APP_VERSION } from "../config/appInfo";
import { appUpdateChecker } from "../services/appUpdate";

export const appUpdateRouter = Router();

// Whether a newer release exists. Silent on failure — the check runs unasked, so it
// answers "no update" rather than an error (services/appUpdate.ts).
appUpdateRouter.get("/app-update", async (_req, res) => {
  res.json(await appUpdateChecker.check(APP_VERSION));
});
```

Modify `src/routes/index.ts` — add the import next to the other route imports:

```ts
import { appUpdateRouter } from "./appUpdate";
```

and register it after the settings router:

```ts
router.use(vaultRouter);
router.use(settingsRouter);
router.use(appUpdateRouter);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/routes/appUpdate.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck and commit**

```bash
npm test
npx tsc --noEmit
git add src/routes/appUpdate.ts src/routes/appUpdate.test.ts src/routes/index.ts
git commit -m "feat(update): endpoint /api/app-update"
```

---

### Task 3: Bundle installer (extract, swap, rollback)

**Files:**
- Create: `src/services/appInstaller.ts`
- Test: `src/services/appInstaller.test.ts`

**Interfaces:**
- Consumes: nothing (plain Node).
- Produces:
  - `resolveAppBundlePath(execPath: string): string`
  - `findAppBundleInDir(dir: string, productName?: string): string | null`
  - `installUpdateFromZip(options: { zipPath: string; appBundlePath: string; run?: (cmd: string, args: string[]) => Promise<void>; rename?: (from: string, to: string) => void }): Promise<void>`
  - `cleanupUpdateLeftovers(appBundlePath: string): void`

- [ ] **Step 1: Write the failing tests**

Create `src/services/appInstaller.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupUpdateLeftovers,
  findAppBundleInDir,
  installUpdateFromZip,
  resolveAppBundlePath,
} from "./appInstaller";

describe("appInstaller", () => {
  let dir: string;
  let appBundlePath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "app-installer-test-"));
    appBundlePath = path.join(dir, "Web to EPUB.app");
    mkdirSync(path.join(appBundlePath, "Contents", "MacOS"), { recursive: true });
    writeFileSync(path.join(appBundlePath, "Contents", "MacOS", "Web to EPUB"), "old binary");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function oldBinary(): string {
    return readFileSync(path.join(appBundlePath, "Contents", "MacOS", "Web to EPUB"), "utf8");
  }

  // Fake ditto: writes a new app bundle into the work dir it is given (args[3]).
  function runCreatingApp(contents = "new binary") {
    return vi.fn(async (cmd: string, args: string[]) => {
      if (cmd !== "ditto") return;
      const newApp = path.join(args[3], "Web to EPUB.app");
      mkdirSync(path.join(newApp, "Contents", "MacOS"), { recursive: true });
      writeFileSync(path.join(newApp, "Contents", "MacOS", "Web to EPUB"), contents);
    });
  }

  it("resolves the bundle from the executable path", () => {
    const execPath = path.join(appBundlePath, "Contents", "MacOS", "Web to EPUB");
    expect(resolveAppBundlePath(execPath)).toBe(appBundlePath);
  });

  it("finds an app bundle at the archive root", () => {
    const archive = mkdtempSync(path.join(dir, "archive-"));
    const app = path.join(archive, "Web to EPUB.app");
    mkdirSync(app);
    expect(findAppBundleInDir(archive)).toBe(app);
  });

  it("finds an app bundle wrapped one level deep", () => {
    const archive = mkdtempSync(path.join(dir, "archive-"));
    const app = path.join(archive, "wrapper", "Web to EPUB.app");
    mkdirSync(app, { recursive: true });
    expect(findAppBundleInDir(archive)).toBe(app);
  });

  it("prefers the product name when several bundles match", () => {
    const archive = mkdtempSync(path.join(dir, "archive-"));
    mkdirSync(path.join(archive, "Helper.app"));
    mkdirSync(path.join(archive, "Web to EPUB.app"));
    expect(findAppBundleInDir(archive, "Web to EPUB")).toBe(path.join(archive, "Web to EPUB.app"));
  });

  it("answers null when the archive has no app bundle", () => {
    const archive = mkdtempSync(path.join(dir, "archive-"));
    writeFileSync(path.join(archive, "readme.txt"), "no app here");
    expect(findAppBundleInDir(archive)).toBeNull();
  });

  it("swaps the bundle, keeps the old one as .old, and clears quarantine", async () => {
    const zipPath = path.join(dir, "update.zip");
    writeFileSync(zipPath, "zip");
    const run = runCreatingApp();

    await installUpdateFromZip({ zipPath, appBundlePath, run });

    expect(oldBinary()).toBe("new binary");
    expect(readFileSync(path.join(`${appBundlePath}.old`, "Contents", "MacOS", "Web to EPUB"), "utf8")).toBe(
      "old binary"
    );
    expect(run).toHaveBeenCalledWith("xattr", ["-cr", appBundlePath]);
  });

  it("fails without touching the app when the archive holds no bundle", async () => {
    const zipPath = path.join(dir, "update.zip");
    writeFileSync(zipPath, "zip");
    const run = vi.fn(async () => {});

    await expect(installUpdateFromZip({ zipPath, appBundlePath, run })).rejects.toThrow(
      /does not contain an app bundle/
    );
    expect(oldBinary()).toBe("old binary");
    expect(existsSync(`${appBundlePath}.old`)).toBe(false);
  });

  it("fails cleanly when the app cannot be renamed (read-only location)", async () => {
    const zipPath = path.join(dir, "update.zip");
    writeFileSync(zipPath, "zip");
    const rename = vi.fn(() => {
      throw new Error("EACCES");
    });

    await expect(installUpdateFromZip({ zipPath, appBundlePath, run: runCreatingApp(), rename })).rejects.toThrow(
      "EACCES"
    );
    expect(rename).toHaveBeenCalledOnce();
    expect(oldBinary()).toBe("old binary");
  });

  it("rolls the old bundle back when the new one cannot be moved in", async () => {
    const zipPath = path.join(dir, "update.zip");
    writeFileSync(zipPath, "zip");
    let calls = 0;
    const rename = vi.fn((from: string, to: string) => {
      calls += 1;
      if (calls === 2) throw new Error("EXDEV");
      renameSync(from, to);
    });

    await expect(installUpdateFromZip({ zipPath, appBundlePath, run: runCreatingApp(), rename })).rejects.toThrow(
      "EXDEV"
    );
    expect(oldBinary()).toBe("old binary");
  });

  it("cleans up .old and stale work dirs on launch", () => {
    renameSync(appBundlePath, `${appBundlePath}.old`);
    mkdirSync(path.join(dir, ".web-to-epub-update-abc"));

    cleanupUpdateLeftovers(appBundlePath);

    expect(existsSync(`${appBundlePath}.old`)).toBe(false);
    expect(existsSync(path.join(dir, ".web-to-epub-update-abc"))).toBe(false);
  });

  it("is a no-op when there is nothing to clean", () => {
    expect(() => cleanupUpdateLeftovers(appBundlePath)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/appInstaller.test.ts`
Expected: FAIL — `Cannot find module './appInstaller'`.

- [ ] **Step 3: Write the installer**

Create `src/services/appInstaller.ts`:

```ts
/**
 * Replacing the running macOS .app bundle with a freshly downloaded release.
 *
 * Squirrel.Mac (electron-updater) refuses unsigned builds and this app is ad-hoc
 * signed, so the update installs itself: extract the release zip, swap the bundle by
 * rename (works while the app runs — the process keeps the old files by inode), and
 * let electron/main.js relaunch. Every failure path restores the old bundle.
 *
 * Plain Node, no Electron imports: electron/main.js requires the compiled
 * dist/services/appInstaller.js, and unit tests drive it with fake ditto/xattr so CI
 * (Ubuntu) never calls macOS-only tools.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ".../Web to EPUB.app/Contents/MacOS/Web to EPUB" -> ".../Web to EPUB.app"
export function resolveAppBundlePath(execPath: string): string {
  return path.resolve(execPath, "..", "..", "..");
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function listNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

// The zip holds "Web to EPUB.app" at its root (electron-builder's layout); some
// archives wrap it in a folder, so one level down is searched too. Prefers the
// bundle named after the app when several .app files sit side by side.
export function findAppBundleInDir(dir: string, productName?: string): string | null {
  const root: string[] = [];
  const nested: string[] = [];
  for (const name of listNames(dir)) {
    const child = path.join(dir, name);
    if (!isDirectory(child)) continue;
    if (child.endsWith(".app")) {
      root.push(child);
      continue;
    }
    for (const inner of listNames(child)) {
      const grandchild = path.join(child, inner);
      if (isDirectory(grandchild) && grandchild.endsWith(".app")) nested.push(grandchild);
    }
  }
  const found = root.length > 0 ? root : nested;
  if (found.length === 0) return null;
  const preferred = productName ? found.find((p) => path.basename(p) === `${productName}.app`) : undefined;
  return preferred ?? found[0];
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
  });
}

export interface InstallUpdateOptions {
  zipPath: string;
  appBundlePath: string;
  // Injected in tests so CI (Ubuntu) never calls ditto/xattr or real renames.
  run?: (cmd: string, args: string[]) => Promise<void>;
  rename?: (from: string, to: string) => void;
}

export async function installUpdateFromZip(options: InstallUpdateOptions): Promise<void> {
  const run = options.run ?? runCommand;
  const rename = options.rename ?? fs.renameSync;
  const appBundlePath = path.resolve(options.appBundlePath);
  const backupPath = `${appBundlePath}.old`;

  if (!appBundlePath.endsWith(".app")) throw new Error(`Not a macOS app bundle: ${appBundlePath}`);
  if (!fs.existsSync(options.zipPath)) throw new Error(`Update archive not found: ${options.zipPath}`);

  // The work dir sits next to the app: same volume, so moving the new bundle into
  // place is a rename (a /tmp extract would make it a cross-device copy).
  const workDir = fs.mkdtempSync(path.join(path.dirname(appBundlePath), ".web-to-epub-update-"));
  try {
    await run("ditto", ["-x", "-k", options.zipPath, workDir]);
    const newApp = findAppBundleInDir(workDir, path.basename(appBundlePath, ".app"));
    if (!newApp) throw new Error("Update archive does not contain an app bundle");

    // A leftover from an interrupted run would make the rename below fail.
    fs.rmSync(backupPath, { recursive: true, force: true });
    rename(appBundlePath, backupPath);
    try {
      rename(newApp, appBundlePath);
    } catch (error) {
      try {
        rename(backupPath, appBundlePath);
      } catch {
        // The rename error below is the useful one; .old stays for the next launch's
        // cleanup.
      }
      throw error;
    }

    // Downloaded by this app, not a browser, so normally there is no quarantine
    // attribute; clear any that is there, then touch the bundle so Launch Services
    // notices the new version. Neither is worth failing a completed swap over.
    try {
      await run("xattr", ["-cr", appBundlePath]);
      await run("touch", [appBundlePath]);
    } catch {
      // ignore
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// Best-effort tidy-up on launch: remove "<app>.old" and stale work dirs from an
// interrupted update. Never throws — leftovers must not block the app.
export function cleanupUpdateLeftovers(appBundlePath: string): void {
  try {
    fs.rmSync(`${appBundlePath}.old`, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    for (const name of listNames(path.dirname(appBundlePath))) {
      if (name.startsWith(".web-to-epub-update-")) {
        fs.rmSync(path.join(path.dirname(appBundlePath), name), { recursive: true, force: true });
      }
    }
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/appInstaller.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Full suite, typecheck and commit**

```bash
npm test
npx tsc --noEmit
git add src/services/appInstaller.ts src/services/appInstaller.test.ts
git commit -m "feat(update): thay .app bundle từ file zip (có rollback)"
```

---

### Task 4: Electron wiring (download + install IPC, preload bridge)

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

**Interfaces:**
- Consumes: `resolveAppBundlePath`, `installUpdateFromZip`, `cleanupUpdateLeftovers` from `dist/services/appInstaller.js` (Task 3).
- Produces: IPC `update:install` (invoke, payload `zipUrl: string`), event `update:progress` with `{ received, total }` then `{ installing: true }`; `window.electronUpdate` bridge (Task 5 types it).

- [ ] **Step 1: Add the requires and update helpers to `electron/main.js`**

Change the top of the file (after the existing requires) to:

```js
const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const path = require("path");
const net = require("net");
const http = require("http");
const fs = require("fs");
const os = require("os");
const fsp = require("fs/promises");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const {
  cleanupUpdateLeftovers,
  installUpdateFromZip,
  resolveAppBundlePath,
} = require(path.join(__dirname, "..", "dist", "services", "appInstaller.js"));
```

- [ ] **Step 2: Add the update IPC handlers**

Insert after the `export:write-file` handler (before `async function start()`):

```js
// ---- App update (see src/services/appInstaller.ts) ---------------------------

// Only assets from our own releases may be downloaded and installed.
const UPDATE_HOSTS = new Set(["github.com", "objects.githubusercontent.com"]);
let updateInstalling = false;

async function downloadUpdate(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const filePath = path.join(os.tmpdir(), `web-to-epub-update-${Date.now()}.zip`);
  let received = 0;
  await pipeline(
    Readable.fromWeb(res.body),
    new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        onProgress({ received, total });
        callback(null, chunk);
      },
    }),
    fs.createWriteStream(filePath)
  );
  return filePath;
}

ipcMain.handle("update:install", async (event, zipUrl) => {
  if (!app.isPackaged) throw new Error("Updates only run in the packaged app");
  if (updateInstalling) throw new Error("An update is already being installed");
  const host = new URL(zipUrl).hostname;
  if (!UPDATE_HOSTS.has(host)) throw new Error(`Refusing to download from ${host}`);

  updateInstalling = true;
  let zipPath = null;
  try {
    zipPath = await downloadUpdate(zipUrl, (progress) => event.sender.send("update:progress", progress));
    event.sender.send("update:progress", { installing: true });
    await installUpdateFromZip({ zipPath, appBundlePath: resolveAppBundlePath(process.execPath) });
    // The bundle at process.execPath is the new one now, so the relaunched instance
    // runs it. The before-quit handler below closes Chromium first.
    app.relaunch();
    app.quit();
  } finally {
    updateInstalling = false;
    if (zipPath) await fsp.rm(zipPath, { force: true }).catch(() => {});
  }
});
```

- [ ] **Step 3: Clean up leftovers on launch**

Replace the `app.whenReady()` block with:

```js
app.whenReady().then(() => {
  // A previous update can leave "<app>.old" or a work dir behind; clear them before
  // anything else. Best-effort (see services/appInstaller.ts).
  if (isPackaged) cleanupUpdateLeftovers(resolveAppBundlePath(process.execPath));
  return start().catch((err) => {
    dialog.showErrorBox("Không khởi động được Web to EPUB", String(err && err.stack ? err.stack : err));
    app.exit(1);
  });
});
```

- [ ] **Step 4: Expose the bridge in `electron/preload.js`**

Append after the existing `contextBridge.exposeInMainWorld("electronExport", ...)` call:

```js
// Update bridge: the packaged app downloads a release zip and replaces its own
// bundle (electron/main.js); the renderer only asks and watches progress.
contextBridge.exposeInMainWorld("electronUpdate", {
  install: (zipUrl) => ipcRenderer.invoke("update:install", zipUrl),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("update:progress", listener);
    return () => ipcRenderer.removeListener("update:progress", listener);
  },
});
```

- [ ] **Step 5: Verify syntax, build output, and commit**

Run:
```bash
node --check electron/main.js
node --check electron/preload.js
npm run build
node -e "const m=require('./dist/services/appInstaller.js'); console.log(Object.keys(m).sort().join(','))"
```
Expected: no syntax errors; the last command prints `cleanupUpdateLeftovers,findAppBundleInDir,installUpdateFromZip,resolveAppBundlePath`.

```bash
git add electron/main.js electron/preload.js
git commit -m "feat(update): tải và cài bản mới trong app Electron"
```

---

### Task 5: Frontend data path (types, bridge declaration, API)

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/types/electron-update.d.ts`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: `GET /api/app-update` (Task 2); `window.electronUpdate` bridge (Task 4).
- Produces:
  - `interface AppUpdateInfo { current: string; latest: string | null; hasUpdate: boolean; releaseUrl: string | null; zipUrl: string | null }`
  - `interface ElectronUpdateBridge { install(zipUrl: string): Promise<void>; onProgress(cb: (p: ElectronUpdateProgress) => void): () => void }` (global `window.electronUpdate?`)
  - `fetchAppUpdate(): Promise<AppUpdateInfo>`

- [ ] **Step 1: Add the shared type**

Append to `frontend/src/types.ts` after `AppInfo`:

```ts
// GET /api/app-update — whether a newer release exists (src/services/appUpdate.ts).
export interface AppUpdateInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  zipUrl: string | null;
}
```

- [ ] **Step 2: Declare the preload bridge**

Create `frontend/src/types/electron-update.d.ts`:

```ts
// Exposed by electron/preload.js only inside the packaged app — download and install
// of a new release (electron/main.js, src/services/appInstaller.ts).
interface ElectronUpdateProgress {
  received?: number;
  total?: number;
  installing?: boolean;
}

interface ElectronUpdateBridge {
  install(zipUrl: string): Promise<void>;
  // Returns an unsubscribe function; the banner removes its listener on unmount.
  onProgress(callback: (progress: ElectronUpdateProgress) => void): () => void;
}

interface Window {
  electronUpdate?: ElectronUpdateBridge;
}
```

- [ ] **Step 3: Add the API call**

In `frontend/src/lib/api.ts`, add `AppUpdateInfo` to the existing types import:

```ts
import { AppInfo, AppSettings, AppUpdateInfo, BookMetadata, StoredChapter, StoredStory, StorySummary, SupportedSite } from "../types";
```

and add below the settings section (before `// ---- Saved site sessions ...`):

```ts
// ---- App update (see src/services/appUpdate.ts) ------------------------------

export async function fetchAppUpdate(): Promise<AppUpdateInfo> {
  const res = await apiFetch("/api/app-update", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not check for updates")));
  return (await res.json()) as AppUpdateInfo;
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `npx tsc -p frontend --noEmit`
Expected: no errors.

```bash
git add frontend/src/types.ts frontend/src/types/electron-update.d.ts frontend/src/lib/api.ts
git commit -m "feat(update): kiểu dữ liệu + API check bản mới ở frontend"
```

---

### Task 6: Update banner UI

**Files:**
- Create: `frontend/src/components/UpdateBanner.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n/locales/en.ts`
- Modify: `frontend/src/i18n/locales/vi.ts`

**Interfaces:**
- Consumes: `fetchAppUpdate()`, `AppUpdateInfo`, `window.electronUpdate` (Task 5).
- Produces: `UpdateBanner({ update, onDismiss }: { update: AppUpdateInfo; onDismiss: () => void })`.

- [ ] **Step 1: Add the i18n keys**

In `frontend/src/i18n/locales/en.ts`, append a section (e.g. after the Job strip block):

```ts
  // Update banner
  "A new version v{version} is available (you have v{current}).": "A new version v{version} is available (you have v{current}).",
  "Update now": "Update now",
  "Downloading…": "Downloading…",
  "Downloading… {pct}%": "Downloading… {pct}%",
  "Installing…": "Installing…",
  "Update failed: {message}": "Update failed: {message}",
  "Open the download page": "Open the download page",
  "Could not check for updates": "Could not check for updates",
```

In `frontend/src/i18n/locales/vi.ts`, append the same keys with Vietnamese values:

```ts
  // Update banner
  "A new version v{version} is available (you have v{current}).": "Đã có bản mới v{version} (bạn đang dùng v{current}).",
  "Update now": "Cập nhật ngay",
  "Downloading…": "Đang tải…",
  "Downloading… {pct}%": "Đang tải… {pct}%",
  "Installing…": "Đang cài đặt…",
  "Update failed: {message}": "Cập nhật thất bại: {message}",
  "Open the download page": "Mở trang tải",
  "Could not check for updates": "Không kiểm tra được bản cập nhật",
```

Note: `"Try again"` and `"Close"` already exist — do not add them again.

- [ ] **Step 2: Write the banner component**

Create `frontend/src/components/UpdateBanner.tsx`:

```tsx
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
```

- [ ] **Step 3: Wire it into `App.tsx`**

Add to the imports:

```tsx
import { UpdateBanner } from "./components/UpdateBanner";
import { fetchAppUpdate, fetchSettings, fetchSupportedSites } from "./lib/api";
import { AppSettings, AppUpdateInfo, SupportedSite } from "./types";
```

Add the state next to `autoScan`:

```tsx
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
```

Add an effect after the existing mount effect:

```tsx
  // One update check per app open; failures stay invisible — the server answers
  // "no update" for offline/GitHub errors (services/appUpdate.ts).
  useEffect(() => {
    fetchAppUpdate()
      .then((info) => setUpdateInfo(info.hasUpdate ? info : null))
      .catch(() => setUpdateInfo(null));
  }, []);
```

Render the banner between the header and the workbench:

```tsx
      {updateInfo && !updateDismissed && (
        <UpdateBanner update={updateInfo} onDismiss={() => setUpdateDismissed(true)} />
      )}

      <div className="workbench">
```

- [ ] **Step 4: Verify tests, typecheck and build**

Run:
```bash
npm test
npx tsc -p frontend --noEmit
npm run build
```
Expected: all pass (locales parity test covers the new keys).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/UpdateBanner.tsx frontend/src/App.tsx frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/vi.ts
git commit -m "feat(update): banner báo bản mới và nút cập nhật"
```

---

### Task 7: Release flow + docs

**Files:**
- Modify: `Makefile`
- Modify: `RELEASE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: releases that carry the `-arm64-mac.zip` asset the updater downloads.

- [ ] **Step 1: Upload the zip in `make release-mac`**

Replace the last two lines of the `release-mac` target in `Makefile`:

```make
release-mac: app ## Build app rồi thay file .dmg + .zip trên GitHub release cùng version
	gh release upload v$(VERSION) "release/Web to EPUB-$(VERSION)-arm64.dmg" "release/Web to EPUB-$(VERSION)-arm64-mac.zip" --clobber
```

- [ ] **Step 2: Update `RELEASE.md`**

In section 5, replace the first paragraph so both artifacts are named:

```md
Builds `release/Web to EPUB-X.Y.Z-arm64.dmg` and `release/Web to EPUB-X.Y.Z-arm64-mac.zip`
(`npm run app:mac`: Electron shell, bundled Chromium, ad-hoc signing) and uploads both
to the release with `gh release upload ... --clobber`. The `.zip` is what the in-app
auto-updater downloads — never skip it. Takes several minutes; ~220 MB each.
```

Keep the note about GitHub dot-mangling and extend it:

```md
GitHub stores the assets as `Web.to.EPUB-X.Y.Z-arm64.dmg` and
`Web.to.EPUB-X.Y.Z-arm64-mac.zip` (spaces become dots) — that is normal.
```

In section 7, replace the verify line:

```sh
gh release view vX.Y.Z --json assets -q '.assets[].name'   # .dmg and -arm64-mac.zip are there
```

- [ ] **Step 3: Update `README.md`**

Add a Features bullet after the "Watch for new chapters" bullet:

```md
- **Auto-update for the macOS app** — the app checks GitHub Releases when it opens and,
  when a newer version exists, offers a one-click update: it downloads the release zip,
  replaces itself, and restarts. The web/Docker build shows the same banner with a link
  to the release page instead.
```

Add to Known Limitations (after the ETA bullet):

```md
- **The macOS app updates itself without Apple code signing** — the release zip is downloaded
  over HTTPS from GitHub Releases (no extra hash check) and the app replaces its own bundle,
  clearing the quarantine attribute macOS would otherwise attach. A future macOS release could
  tighten this; if self-install stops working, the banner's download link still works. The app
  must live in a user-writable folder (`/Applications` is fine; running it from the mounted DMG
  is not).
- **Update checks run once per app open** — a release published while the app is open is only
  noticed after a restart. Docker users update by pulling the new image; the banner is only
  informational there.
```

- [ ] **Step 4: Verify and commit**

Run:
```bash
make -n release-mac | tail -1
```
Expected: the dry-run line contains both `-arm64.dmg` and `-arm64-mac.zip`.

```bash
git add Makefile RELEASE.md README.md
git commit -m "docs(release): phát hành kèm file zip cho tự động cập nhật"
```

---

### Task 8: Manual end-to-end verification (human)

**Files:** none — this is the acceptance pass from the spec.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified release path.

- [ ] **Step 1: Build and install the current version**

```bash
make app
# drag release/Web to EPUB-<current>-arm64.dmg into /Applications, open it once
```

- [ ] **Step 2: Publish a newer release**

Bump the version per `RELEASE.md` (e.g. to the next patch), tag, create the GitHub
release, then `make release-mac` (uploads DMG + ZIP).

- [ ] **Step 3: Verify the happy path**

Open the installed (older) app → banner appears with both versions → **Update now** →
progress % → app restarts on the new version, no Gatekeeper prompt, no `.old` folder
left in `/Applications`.

- [ ] **Step 4: Verify failure paths**

1. Truncate/corrupt the ZIP asset on the release → **Update now** fails, the app stays
   running on the old version, the banner shows the error and **Try again**.
2. Run the app from the mounted DMG → the install fails with the
   "move it to Applications" message.
3. `npm start` in a browser (web/Docker) → banner with **Open the download page** only.

- [ ] **Step 5: Final gate**

```bash
npm test
npx tsc -p frontend --noEmit
npx tsc -p e2e --noEmit
npm run build
```
Expected: all pass.
