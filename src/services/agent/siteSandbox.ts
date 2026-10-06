/**
 * Runs crawler code written by a local agent in a child process (agent/siteRunner.cjs) started with
 * Node's permission model — no file writes, no child processes, no native bindings — and with the
 * network APIs taken away there. The code's only way out is `ctx.fetchText / fetchJson / render`,
 * which arrive here and are answered only for the host being crawled.
 *
 * One child serves every run (starting it loads jsdom, about a second) and exits after a minute idle.
 */
import { ChildProcess, fork } from "node:child_process";
import path from "node:path";
import { AGENT_RUNNER } from "../../config/paths";
import { fetchWithRetry } from "../toc/http";
import { renderPageHtml } from "../renderer";

const RUN_TIMEOUT_MS = 120_000;
const IDLE_MS = 60_000;
const MAX_POST_BYTES = 10_000;
const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

interface Run {
  host: string;
  pageUrl: string;
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: NodeJS.Timeout;
}

let child: ChildProcess | undefined;
let ready: Promise<ChildProcess> | undefined;
let idleTimer: NodeJS.Timeout | undefined;
let nextRun = 0;
const runs = new Map<number, Run>();

function stop(reason: string) {
  const dying = child;
  child = undefined;
  ready = undefined;
  clearTimeout(idleTimer);
  dying?.kill();
  for (const [id, run] of runs) {
    clearTimeout(run.timer);
    run.reject(new Error(reason));
    runs.delete(id);
  }
}

async function answerFetch(target: ChildProcess, message: { id: number; run: number; kind: "text" | "render" | "post"; url: string; body?: string }) {
  const reply = (body: { ok: boolean; body?: string; error?: string }) => target.connected && target.send({ type: "fetched", id: message.id, ...body });
  const run = runs.get(message.run);
  try {
    // An address in a page's script is usually relative to the page, so it is read the way a browser would.
    const pageTarget = run ? new URL(message.url, run.pageUrl).href : message.url;
    const url = new URL(pageTarget);
    if (!run || !/^https?:$/.test(url.protocol) || hostOf(pageTarget) !== run.host) throw new Error(`The code may only load pages of ${run?.host ?? "the site"}`);
    if (message.kind === "render") return reply({ ok: true, body: await renderPageHtml(pageTarget) });
    // A page's own scripts often load the data (a chapter list) with a form POST to the same site: the code may too.
    const init: RequestInit =
      message.kind === "post"
        ? {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", referer: run.pageUrl },
            body: String(message.body ?? "").slice(0, MAX_POST_BYTES),
          }
        : {};
    const res = await fetchWithRetry(pageTarget, init, { maxAttempts: 2 });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${pageTarget}`);
    reply({ ok: true, body: await res.text() });
  } catch (err) {
    reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function start(): Promise<ChildProcess> {
  if (ready) return ready;
  const jsdomModules = path.dirname(path.dirname(require.resolve("jsdom/package.json")));
  const proc = fork(AGENT_RUNNER, [], {
    execPath: process.execPath,
    execArgv: ["--permission", `--allow-fs-read=${path.dirname(AGENT_RUNNER)}`, `--allow-fs-read=${jsdomModules}`],
    // Nothing from the app's environment (keys, tokens) reaches the code.
    env: { ELECTRON_RUN_AS_NODE: "1", PATH: process.env.PATH ?? "" },
    cwd: path.dirname(AGENT_RUNNER),
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  child = proc;
  let stderr = "";
  proc.stderr?.on("data", (chunk) => (stderr = (stderr + chunk).slice(-400)));
  proc.on("exit", () => {
    if (child === proc) stop(`The crawler process stopped: ${stderr.trim() || "no details"}`);
  });
  proc.on("message", (message: any) => {
    if (message.type === "fetch") void answerFetch(proc, message);
    else if (message.type === "result" || message.type === "error") {
      const run = runs.get(message.run);
      if (!run) return;
      runs.delete(message.run);
      clearTimeout(run.timer);
      if (message.type === "result") run.resolve(message.value);
      else run.reject(new Error(message.message));
      if (runs.size === 0) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => stop("idle"), IDLE_MS);
        idleTimer.unref();
      }
    }
  });
  ready = new Promise<ChildProcess>((resolve, reject) => {
    const onReady = (message: any) => {
      if (message.type !== "ready") return;
      proc.off("message", onReady);
      resolve(proc);
    };
    proc.on("message", onReady);
    proc.once("exit", () => reject(new Error(`The crawler process did not start: ${stderr.trim() || "no details"}`)));
  });
  ready.catch(() => {});
  return ready;
}

// Runs the `fn` ("toc", "chapter" or "article") defined by `code` on the page at `url` (already loaded as `html`)
// and returns what it returned, as plain JSON. The caller checks the shape.
export async function runSiteCode(options: { code: string; fn: "toc" | "chapter" | "article"; url: string; html: string }): Promise<unknown> {
  const proc = await start();
  clearTimeout(idleTimer);
  const run = ++nextRun;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => stop("The crawler code took too long"), RUN_TIMEOUT_MS);
    runs.set(run, { host: hostOf(options.url), pageUrl: options.url, resolve, reject, timer });
    proc.send({ type: "run", run, ...options }, (err) => {
      if (err) {
        clearTimeout(timer);
        runs.delete(run);
        reject(err);
      }
    });
  });
}

export function stopSiteRunner(): void {
  stop("stopped");
}
