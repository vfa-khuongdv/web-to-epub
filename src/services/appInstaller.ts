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
