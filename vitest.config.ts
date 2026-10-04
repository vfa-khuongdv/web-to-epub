import { defineConfig } from "vitest/config";

// `rtk vitest` (RTK's token-saving proxy) runs `vitest run --reporter=json` and parses the
// report from stdout, but vitest 5's JSON reporter writes it to a file by default. When the
// json reporter is asked for on the command line (only rtk does), print it to stdout through
// vitest's own logger — writing to /dev/stdout instead fails with EAGAIN on large reports.
// Plain `npm test` (default reporter) is untouched.
const jsonReporterOnCli = process.argv.some((arg) => arg.startsWith("--reporter=json"));

export default defineConfig({
  // Frontend component tests (.tsx) use the automatic JSX runtime, like the Vite build.
  esbuild: { jsx: "automatic" },
  test: {
    ...(jsonReporterOnCli ? { reporters: [["json", { stdout: true }]] } : {}),
  },
});
