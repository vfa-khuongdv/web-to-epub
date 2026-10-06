/**
 * Runs the page analysis of domAnalysis.ts in a worker thread. The server shares its thread with the
 * app's window (Electron's main process), and parsing a big page with jsdom takes seconds — long enough
 * for the window to stop answering. From TypeScript source (tests) there is no compiled worker file, so
 * the same functions run inline.
 */
import path from "node:path";
import { Worker } from "node:worker_threads";
import * as analysis from "./domAnalysis";

type Fn = "skeleton" | "pageScripts" | "missedChapters" | "missedPictures" | "articleMissing";

const IDLE_MS = 60_000;
const pending = new Map<number, { resolve(value: any): void; reject(err: Error): void }>();
let worker: Worker | undefined;
let idleTimer: NodeJS.Timeout | undefined;
let nextId = 0;

function stop(reason: string) {
  const dying = worker;
  worker = undefined;
  clearTimeout(idleTimer);
  void dying?.terminate();
  for (const [id, call] of pending) {
    pending.delete(id);
    call.reject(new Error(reason));
  }
}

function start(): Worker {
  if (worker) return worker;
  const created = new Worker(path.join(__dirname, "domWorker.js"));
  created.unref();
  created.on("message", ({ id, result, error }: { id: number; result?: unknown; error?: string }) => {
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    if (error !== undefined) call.reject(new Error(error));
    else call.resolve(result);
    if (pending.size === 0) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stop("idle"), IDLE_MS);
      idleTimer.unref();
    }
  });
  created.on("error", (err) => worker === created && stop(`The page analysis stopped: ${err.message}`));
  created.on("exit", () => worker === created && stop("The page analysis stopped"));
  worker = created;
  return created;
}

export function analyse<F extends Fn>(fn: F, ...args: Parameters<(typeof analysis)[F]>): Promise<ReturnType<(typeof analysis)[F]>> {
  if (!__filename.endsWith(".js")) return Promise.resolve((analysis[fn] as (...a: unknown[]) => any)(...args));
  clearTimeout(idleTimer);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    start().postMessage({ id, fn, args });
  });
}
