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

  it("asks the user to move the app when the rename is denied", async () => {
    const zipPath = path.join(dir, "update.zip");
    writeFileSync(zipPath, "zip");
    const rename = vi.fn(() => {
      throw Object.assign(new Error("EACCES: permission denied, rename '/Applications/Web to EPUB.app'"), {
        code: "EACCES",
      });
    });

    await expect(installUpdateFromZip({ zipPath, appBundlePath, run: runCreatingApp(), rename })).rejects.toThrow(
      "The app cannot replace itself here — move it to Applications and try again, or download the new version from the release page."
    );
    expect(rename).toHaveBeenCalledOnce();
    expect(oldBinary()).toBe("old binary");
  });

  it("reports a clear error when the update archive cannot be unpacked", async () => {
    const zipPath = path.join(dir, "update.zip");
    writeFileSync(zipPath, "zip");
    const cause = new Error("ditto exited with code 1");
    const run = vi.fn(async (cmd: string) => {
      if (cmd === "ditto") throw cause;
    });

    const error = await installUpdateFromZip({ zipPath, appBundlePath, run }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Could not unpack the update archive");
    expect((error as Error & { cause?: unknown }).cause).toBe(cause);
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
