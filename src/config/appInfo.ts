import fs from "fs";
import path from "path";

/**
 * The version the settings page shows. package.json sits two levels above this file in
 * every layout that runs it — dist/config/ when built, src/config/ under vitest, and
 * the same dist/config/ inside the packaged app — so one path covers them all. It is
 * read once: the file cannot change while the process runs.
 */
function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

export const APP_VERSION = readVersion();
