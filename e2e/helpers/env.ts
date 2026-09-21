import path from "path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
// Wiped by the app webServer command at the start of every run (see playwright.config.ts).
// E2E_DATA_DIR lets requested parallel E2E runs (each on its own ports) keep isolated
// libraries instead of colliding on one SQLite file.
export const DATA_DIR = process.env.E2E_DATA_DIR ?? path.join(REPO_ROOT, "e2e", ".data");
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 4310);
export const FIXTURE_PORT = Number(process.env.E2E_FIXTURE_PORT ?? 4311);
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;
export const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;
