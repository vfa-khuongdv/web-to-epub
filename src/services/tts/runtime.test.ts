import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIENEU_VERSION } from "../../config/tts";
import { TtsRuntime, TtsRuntimeDeps, createTtsRuntime } from "./runtime";
import { startTtsWorker } from "./workerClient";

const FAKE_WORKER = path.join(__dirname, "__fixtures__", "fakeWorker.js");

describe("TTS runtime", () => {
  let ttsDir: string;
  let runtime: TtsRuntime;
  let deps: TtsRuntimeDeps;
  let commands: string[];

  beforeEach(async () => {
    ttsDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "tts-rt-")), "tts");
    commands = [];
    deps = {
      ttsDir,
      workerScript: FAKE_WORKER,
      constraintsFile: path.join(path.dirname(ttsDir), "constraints.txt"),
      uvUrl: "https://example.test/uv.tar.gz",
      download: vi.fn(async (_url: string, dest: string, onBytes: (d: number, t: number) => void) => {
        onBytes(5, 10);
        await fs.writeFile(dest, "archive");
      }),
      // "tar" lays out uv-<target>/uv like the real archive; "uv venv" makes bin/python.
      exec: vi.fn(async (command: string, args: string[]) => {
        commands.push([path.basename(command), ...args.slice(0, 2)].join(" "));
        if (command === "tar") {
          const into = args[args.indexOf("-C") + 1];
          await fs.mkdir(path.join(into, "uv-aarch64-apple-darwin"), { recursive: true });
          await fs.writeFile(path.join(into, "uv-aarch64-apple-darwin", "uv"), "#!uv");
        } else if (args[0] === "venv") {
          await fs.mkdir(path.join(args[3], "bin"), { recursive: true });
          await fs.writeFile(path.join(args[3], "bin", "python"), "");
        }
      }),
      // The real python in venv is a stub file: run the fake worker with node instead.
      startWorker: vi.fn((cmd, log) => startTtsWorker({ ...cmd, command: process.execPath }, log)),
      idleMs: 50,
      log: () => {},
    };
    await fs.writeFile(deps.constraintsFile, "onnxruntime==1.24.4\n");
    runtime = createTtsRuntime(deps);
  });

  afterEach(async () => {
    runtime.shutdown();
    await fs.rm(path.dirname(ttsDir), { recursive: true, force: true });
  });

  it("starts not installed", async () => {
    expect(await runtime.status()).toMatchObject({ supported: true, state: "not-installed", running: false, busy: false });
  });

  it("reports unsupported platforms and refuses to install", async () => {
    runtime = createTtsRuntime({ ...deps, uvUrl: undefined });
    expect((await runtime.status()).supported).toBe(false);
    await expect(runtime.install("turbo")).rejects.toThrow("not supported");
    expect((await runtime.status()).state).toBe("error");
  });

  it("installs uv, python, vieneu and the model, then marks itself installed", async () => {
    const install = runtime.install("nano");
    expect((await runtime.status()).state).toBe("installing");
    await install;

    expect(commands[0]).toMatch(/^tar -xzf .*uv\.tar\.gz$/);
    expect(commands.slice(1)).toEqual(["uv venv --python", "uv pip install"]);
    expect(await fs.readFile(path.join(ttsDir, "bin", "uv"), "utf8")).toBe("#!uv");
    expect(JSON.parse(await fs.readFile(path.join(ttsDir, "installed.json"), "utf8")).vieneu).toBe(VIENEU_VERSION);
    const status = await runtime.status();
    expect(status).toMatchObject({ state: "installed", running: true });
    expect(status.phase).toBeUndefined();

    // Worker gets HF_HOME inside the TTS dir, and the committed script.
    const [cmd] = vi.mocked(deps.startWorker).mock.calls[0];
    expect(cmd.env?.HF_HOME).toBe(path.join(ttsDir, "hf"));
    expect(cmd.args).toEqual([FAKE_WORKER]);
  });

  it("installs with the constraints file and asks to install again when it changes", async () => {
    await runtime.install("turbo");
    const pip = vi.mocked(deps.exec).mock.calls.find(([, args]) => args[0] === "pip")!;
    expect(pip[1]).toEqual(["pip", "install", "--python", expect.any(String), "-c", "constraints.txt", `vieneu==${VIENEU_VERSION}`]);
    expect(pip[3]).toBe(path.dirname(deps.constraintsFile));
    expect((await runtime.status()).state).toBe("installed");

    await fs.writeFile(deps.constraintsFile, "onnxruntime==1.24.5\n");
    expect((await runtime.status()).state).toBe("not-installed");
    await runtime.install("turbo");
    expect((await runtime.status()).state).toBe("installed");
  });

  it("throws away a model cache written by other library versions, keeps one written by these", async () => {
    const leftover = path.join(ttsDir, "hf", "hub", "stale-blob");
    await fs.mkdir(path.dirname(leftover), { recursive: true });
    await fs.writeFile(leftover, "downloaded by another huggingface_hub");
    await runtime.install("turbo");
    await expect(fs.access(leftover)).rejects.toThrow();

    const partial = path.join(ttsDir, "hf", "hub", "partial.incomplete");
    await fs.mkdir(path.dirname(partial), { recursive: true });
    await fs.writeFile(partial, "resume me");
    await runtime.install("turbo");
    expect(await fs.readFile(partial, "utf8")).toBe("resume me");
  });

  it("reinstalling skips the steps already done", async () => {
    await runtime.install("turbo");
    commands.length = 0;
    await runtime.install("turbo");
    expect(commands).toEqual(["uv pip install"]);
    expect(deps.download).toHaveBeenCalledTimes(1);
  });

  it("shares one install between concurrent callers", async () => {
    const a = runtime.install("turbo");
    const b = runtime.install("turbo");
    expect(a).toBe(b);
    await a;
  });

  it("records a failed step as the error to show, and can retry", async () => {
    vi.mocked(deps.exec).mockImplementationOnce(async () => {
      throw new Error("tar failed");
    });
    await expect(runtime.install("turbo")).rejects.toThrow("tar failed");
    expect(await runtime.status()).toMatchObject({ state: "error", error: "tar failed" });
    await runtime.install("turbo");
    expect((await runtime.status()).state).toBe("installed");
  });

  it("serializes model work and switches variants between calls", async () => {
    await runtime.install("turbo");
    const order: string[] = [];
    await Promise.all([
      runtime.withModel("turbo", async (_w, model) => {
        order.push(`start ${model.variant}`);
        await new Promise((r) => setTimeout(r, 20));
        order.push(`end ${model.variant}`);
      }),
      runtime.withModel("nano", async (_w, model) => {
        order.push(`start ${model.variant}`);
      }),
    ]);
    expect(order).toEqual(["start turbo", "end turbo", "start nano"]);
  });

  it("closes the worker after the idle delay and restarts it on demand", async () => {
    await runtime.install("turbo");
    await new Promise((r) => setTimeout(r, 120));
    expect((await runtime.status()).running).toBe(false);
    await runtime.withModel("turbo", async (_w, model) => expect(model.variant).toBe("turbo"));
    expect(deps.startWorker).toHaveBeenCalledTimes(2);
  });

  it("restarts a worker that died", async () => {
    await runtime.install("turbo");
    await expect(
      runtime.withModel("turbo", (worker) => worker.synth({ parts: ["CRASH"], voice: "", out: path.join(ttsDir, "x.mp3") }))
    ).rejects.toThrow(/exited/);
    await runtime.withModel("turbo", async () => undefined);
    expect(deps.startWorker).toHaveBeenCalledTimes(2);
  });

  it("refuses to uninstall while busy, otherwise removes everything", async () => {
    await runtime.install("turbo");
    let release!: () => void;
    const busy = runtime.withModel("turbo", () => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 20));
    expect((await runtime.status()).busy).toBe(true);
    await expect(runtime.uninstall()).rejects.toThrow("running");
    release();
    await busy;

    expect(await runtime.diskBytes()).toBeGreaterThan(0);
    await runtime.uninstall();
    await expect(fs.access(ttsDir)).rejects.toThrow();
    expect(await runtime.status()).toMatchObject({ state: "not-installed", running: false });
  });
});
