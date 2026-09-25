import { spawn } from "child_process";
import { createHash } from "crypto";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { CONSTRAINTS_FILE, PYTHON_VERSION, TTS_DIR, VIENEU_VERSION, WORKER_SCRIPT, uvDownloadUrl } from "../../config/tts";
import { t } from "../lang";
import { LoadedModel, TtsVariant, TtsWorker, WorkerCommand, startTtsWorker } from "./workerClient";

/**
 * The Python side of narration, installed and run by the app itself:
 *
 *   <TTS_DIR>/bin/uv          standalone uv, downloaded from its GitHub release
 *   <TTS_DIR>/python/         the CPython uv fetches (UV_PYTHON_INSTALL_DIR)
 *   <TTS_DIR>/venv/           virtualenv with `vieneu` pinned to VIENEU_VERSION
 *   <TTS_DIR>/hf/             model files (HF_HOME), stamped with the constraints hash that
 *                             downloaded them: huggingface_hub versions lay the cache out
 *                             differently, and onnxruntime rejects a model whose external
 *                             data file resolves outside the model's own blob folder
 *   <TTS_DIR>/installed.json  written last: its presence is what "installed" means — and it
 *                             records the VieNeu version and a hash of the constraints, so
 *                             changing either makes the app ask to install again
 *
 * One worker process at most, started on first use and closed after a quiet spell, so
 * the ~1 GB model is not held in RAM by an app that is only crawling.
 */
export type TtsInstallPhase = "uv" | "python" | "packages" | "model";

export interface TtsStatus {
  supported: boolean;
  state: "not-installed" | "installing" | "installed" | "error";
  phase?: TtsInstallPhase;
  // Bytes of the current download, when the phase has one to report.
  downloaded?: number;
  total?: number;
  error?: string;
  version: string;
  running: boolean;
  busy: boolean;
}

export interface TtsRuntimeDeps {
  ttsDir: string;
  workerScript: string;
  constraintsFile: string;
  uvUrl: string | undefined;
  download(url: string, dest: string, onBytes: (done: number, total: number) => void): Promise<void>;
  exec(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void>;
  startWorker(cmd: WorkerCommand, log: (line: string) => void): Promise<TtsWorker>;
  idleMs: number;
  log(line: string): void;
}

export interface TtsRuntime {
  status(): Promise<TtsStatus>;
  // Resolves when the install finishes; status() reports progress meanwhile.
  install(variant: TtsVariant): Promise<void>;
  uninstall(): Promise<void>;
  // Run `fn` with the worker holding `variant`. Calls are serialized: one narration or
  // preview at a time, so a model switch never lands in the middle of someone's chapter.
  withModel<T>(variant: TtsVariant, fn: (worker: TtsWorker, model: LoadedModel) => Promise<T>): Promise<T>;
  diskBytes(): Promise<number>;
  shutdown(): void;
}

export function createTtsRuntime(deps: TtsRuntimeDeps): TtsRuntime {
  const uvBin = path.join(deps.ttsDir, "bin", "uv");
  const venvDir = path.join(deps.ttsDir, "venv");
  const python = path.join(venvDir, "bin", "python");
  const marker = path.join(deps.ttsDir, "installed.json");
  const hfDir = path.join(deps.ttsDir, "hf");
  const hfStamp = path.join(hfDir, ".constraints");

  // Keep every tool inside TTS_DIR and away from the user's own uv / pip / HF config.
  const env: NodeJS.ProcessEnv = {
    UV_PYTHON_INSTALL_DIR: path.join(deps.ttsDir, "python"),
    UV_NO_CACHE: "1",
    UV_NO_CONFIG: "1",
    UV_PYTHON_PREFERENCE: "only-managed",
    HF_HOME: hfDir,
    HF_HUB_DISABLE_TELEMETRY: "1",
  };

  let installing: Promise<void> | undefined;
  let progress: Pick<TtsStatus, "phase" | "downloaded" | "total"> = {};
  let lastError: string | undefined;

  let worker: TtsWorker | undefined;
  let model: LoadedModel | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let idleTimer: NodeJS.Timeout | undefined;

  async function constraintsHash(): Promise<string> {
    return createHash("sha1").update(await fs.readFile(deps.constraintsFile)).digest("hex");
  }

  async function isInstalled(): Promise<boolean> {
    try {
      const saved = JSON.parse(await fs.readFile(marker, "utf8")) as { vieneu?: string; constraints?: string };
      return saved.vieneu === VIENEU_VERSION && saved.constraints === (await constraintsHash());
    } catch {
      return false;
    }
  }

  async function exists(file: string): Promise<boolean> {
    return fs.access(file).then(
      () => true,
      () => false
    );
  }

  function closeWorker() {
    clearTimeout(idleTimer);
    idleTimer = undefined;
    worker?.close();
    worker = undefined;
    model = undefined;
  }

  async function ensureWorker(): Promise<TtsWorker> {
    if (worker && !worker.closed) return worker;
    model = undefined;
    worker = await deps.startWorker({ command: python, args: [deps.workerScript], env }, deps.log);
    return worker;
  }

  async function installSteps(variant: TtsVariant) {
    if (!deps.uvUrl) throw new Error(t("Narration is not supported on this platform"));
    await fs.mkdir(path.join(deps.ttsDir, "bin"), { recursive: true });

    if (!(await exists(uvBin))) {
      progress = { phase: "uv" };
      const tmp = await fs.mkdtemp(path.join(deps.ttsDir, "uv-"));
      try {
        const archive = path.join(tmp, "uv.tar.gz");
        await deps.download(deps.uvUrl, archive, (downloaded, total) => {
          progress = { phase: "uv", downloaded, total };
        });
        await deps.exec("tar", ["-xzf", archive, "-C", tmp], {});
        // The archive holds uv-<target>/uv; take it from wherever it landed.
        const folder = (await fs.readdir(tmp, { withFileTypes: true })).find((entry) => entry.isDirectory());
        const extracted = folder ? path.join(tmp, folder.name, "uv") : path.join(tmp, "uv");
        await fs.rename(extracted, uvBin);
        await fs.chmod(uvBin, 0o755);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    }

    if (!(await exists(python))) {
      progress = { phase: "python" };
      await deps.exec(uvBin, ["venv", "--python", PYTHON_VERSION, venvDir], env);
    }

    progress = { phase: "packages" };
    // -c: exact versions of every dependency, so today's release of some transitive package
    // cannot change what the model runs on (see tts/constraints.txt).
    await deps.exec(
      uvBin,
      ["pip", "install", "--python", python, "-c", deps.constraintsFile, `vieneu==${VIENEU_VERSION}`],
      env
    );

    // Loading once downloads the model, so the first narration does not stall on it. A cache
    // written by other library versions is thrown away first (a partial download by these
    // same versions is kept and resumed).
    progress = { phase: "model" };
    const hash = await constraintsHash();
    const stamp = await fs.readFile(hfStamp, "utf8").catch(() => undefined);
    if (stamp !== hash) {
      await fs.rm(hfDir, { recursive: true, force: true });
      await fs.mkdir(hfDir, { recursive: true });
      await fs.writeFile(hfStamp, hash);
    }
    closeWorker();
    await runtime.withModel(variant, async () => undefined);

    await fs.writeFile(
      marker,
      JSON.stringify({ vieneu: VIENEU_VERSION, constraints: await constraintsHash(), installedAt: new Date().toISOString() })
    );
  }

  const runtime: TtsRuntime = {
    async status() {
      const installed = await isInstalled();
      const state: TtsStatus["state"] = installing
        ? "installing"
        : installed
          ? "installed"
          : lastError
            ? "error"
            : "not-installed";
      return {
        supported: deps.uvUrl !== undefined,
        state,
        ...(installing ? progress : {}),
        ...(state === "error" ? { error: lastError } : {}),
        version: VIENEU_VERSION,
        running: worker !== undefined && !worker.closed,
        busy: pending > 0,
      };
    },

    install(variant) {
      if (installing) return installing;
      lastError = undefined;
      progress = {};
      installing = installSteps(variant)
        .catch((err: unknown) => {
          lastError = err instanceof Error ? err.message : String(err);
          throw err;
        })
        .finally(() => {
          installing = undefined;
          progress = {};
        });
      return installing;
    },

    async uninstall() {
      if (installing) throw new Error(t("Narration is being installed — wait for it to finish"));
      if (pending > 0) throw new Error(t("Narration is running — stop it first"));
      closeWorker();
      lastError = undefined;
      await fs.rm(deps.ttsDir, { recursive: true, force: true });
    },

    withModel(variant, fn) {
      pending++;
      clearTimeout(idleTimer);
      const run = async () => {
        const current = await ensureWorker();
        if (model?.variant !== variant) model = await current.load(variant);
        return fn(current, model);
      };
      const result = tail.then(run, run).finally(() => {
        pending--;
        if (pending === 0 && worker) {
          idleTimer = setTimeout(closeWorker, deps.idleMs);
          idleTimer.unref();
        }
      });
      tail = result.catch(() => {});
      return result;
    },

    async diskBytes() {
      let total = 0;
      const walk = async (dir: string) => {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (entry.isFile()) total += (await fs.stat(full)).size;
        }
      };
      await walk(deps.ttsDir);
      return total;
    },

    shutdown() {
      closeWorker();
    },
  };

  return runtime;
}

async function downloadToFile(url: string, dest: string, onBytes: (done: number, total: number) => void) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(t("Download failed ({status})", { status: res.status }));
  const total = Number(res.headers.get("content-length")) || 0;
  let done = 0;
  const body = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    done += chunk.length;
    onBytes(done, total);
  });
  await pipeline(body, createWriteStream(dest));
}

// Output goes to the server log; on failure the last lines become the error the settings
// page shows, since "exit code 1" alone tells the reader nothing.
function execLogged(log: (line: string) => void) {
  return (command: string, args: string[], extraEnv: NodeJS.ProcessEnv) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
      const tail: string[] = [];
      const collect = (chunk: Buffer) => {
        for (const line of chunk.toString("utf8").split(/\r?\n/)) {
          if (!line.trim()) continue;
          log(line);
          tail.push(line);
          if (tail.length > 5) tail.shift();
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${path.basename(command)} ${args[0]} failed (${code}): ${tail.join(" | ")}`));
      });
    });
}

const log = (line: string) => console.log(`[tts] ${line}`);

export const ttsRuntime = createTtsRuntime({
  ttsDir: TTS_DIR,
  workerScript: WORKER_SCRIPT,
  constraintsFile: CONSTRAINTS_FILE,
  uvUrl: uvDownloadUrl(),
  download: downloadToFile,
  exec: execLogged(log),
  startWorker: startTtsWorker,
  idleMs: 10 * 60_000,
  log,
});
