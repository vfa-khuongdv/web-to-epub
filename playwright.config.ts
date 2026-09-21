import { defineConfig } from "@playwright/test";
import { APP_PORT, APP_URL, DATA_DIR, FIXTURE_PORT, FIXTURE_URL } from "./e2e/helpers/env";

export default defineConfig({
  testDir: "./e2e/tests",
  // *.e2e.ts (not *.spec.ts): vitest's default include matches *.spec.ts and `npm test`
  // must stay hermetic.
  testMatch: "**/*.e2e.ts",
  workers: 1,
  fullyParallel: false,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: APP_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      // Wipe the library in the one process that opens it: Playwright config modules can
      // be re-evaluated per worker, so a wipe at config scope could run mid-suite.
      command: 'rm -rf "${E2E_DATA_DIR:-e2e/.data}" && node dist/server.js',
      url: `${APP_URL}/api/supported-sites`,
      env: { ...(process.env as Record<string, string>), PORT: String(APP_PORT), DATA_DIR },
      reuseExistingServer: false,
    },
  ],
});
