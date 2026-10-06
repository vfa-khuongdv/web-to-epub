// Thread that runs the page analysis of domAnalysis.ts for domClient.ts.
import { parentPort } from "node:worker_threads";
import * as analysis from "./domAnalysis";

const run = analysis as unknown as Record<string, (...args: unknown[]) => unknown>;

parentPort?.on("message", ({ id, fn, args }: { id: number; fn: string; args: unknown[] }) => {
  try {
    parentPort?.postMessage({ id, result: run[fn](...args) });
  } catch (err) {
    parentPort?.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
});
