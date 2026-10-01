// Installs Playwright's headless Chromium into build/ms-playwright (bundled by
// electron-builder's extraResources). A script instead of an inline
// `PLAYWRIGHT_BROWSERS_PATH=... playwright install`, because npm runs scripts through
// cmd.exe on Windows, which does not understand that syntax.
const { spawnSync } = require("child_process");
const path = require("path");

const result = spawnSync("npx", ["playwright", "install", "--only-shell", "chromium"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(__dirname, "..", "build", "ms-playwright") },
});
process.exit(result.status ?? 1);
