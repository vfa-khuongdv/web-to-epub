import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NarrationCancelled, TtsWorker, startTtsWorker } from "./workerClient";

const FAKE = path.join(__dirname, "__fixtures__", "fakeWorker.js");

describe("TTS worker client", () => {
  let dir: string;
  let worker: TtsWorker | undefined;
  const logs: string[] = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tts-worker-"));
    logs.length = 0;
    worker = await startTtsWorker({ command: process.execPath, args: [FAKE] }, (line) => logs.push(line));
  });
  afterEach(async () => {
    worker?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("loads a model and lists its voices; forwards stderr to the log", async () => {
    const loaded = await worker!.load("nano");
    expect(loaded).toEqual({ variant: "nano", voices: [{ id: "A", label: "A — test" }], sampleRate: 24000 });
    expect(logs).toContain("loading nano");
  });

  it("synthesizes with per-part progress", async () => {
    await worker!.load("turbo");
    const out = path.join(dir, "1.mp3");
    const progress: [number, number][] = [];
    const result = await worker!.synth({ parts: ["a", "b"], voice: "A", out, onProgress: (p, n) => progress.push([p, n]) });
    expect(result).toEqual({ seconds: 2 });
    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(await fs.readFile(out, "utf8")).toBe("turbo:A:a|b");
  });

  it("serves queued requests one at a time, in order", async () => {
    await worker!.load("turbo");
    const [a, b] = await Promise.all([
      worker!.synth({ parts: ["SLOW"], voice: "A", out: path.join(dir, "a.mp3") }),
      worker!.synth({ parts: ["x", "y", "z"], voice: "A", out: path.join(dir, "b.mp3") }),
    ]);
    expect(a.seconds).toBe(1);
    expect(b.seconds).toBe(3);
  });

  it("cancels through an AbortSignal and keeps serving afterwards", async () => {
    await worker!.load("turbo");
    const abort = new AbortController();
    const pending = worker!.synth({
      parts: ["SLOW", "SLOW", "SLOW"],
      voice: "A",
      out: path.join(dir, "c.mp3"),
      signal: abort.signal,
      onProgress: () => abort.abort(),
    });
    await expect(pending).rejects.toBeInstanceOf(NarrationCancelled);
    await expect(fs.access(path.join(dir, "c.mp3"))).rejects.toThrow();

    const next = await worker!.synth({ parts: ["ok"], voice: "A", out: path.join(dir, "d.mp3") });
    expect(next.seconds).toBe(1);
  });

  it("rejects an already-aborted request without sending it", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(worker!.synth({ parts: ["a"], voice: "A", out: path.join(dir, "e.mp3"), signal: abort.signal })).rejects.toBeInstanceOf(
      NarrationCancelled
    );
  });

  it("turns a worker error into a rejection and keeps serving", async () => {
    await worker!.load("turbo");
    await expect(worker!.synth({ parts: ["FAIL"], voice: "A", out: path.join(dir, "f.mp3") })).rejects.toThrow("bad part");
    await expect(worker!.synth({ parts: ["ok"], voice: "A", out: path.join(dir, "g.mp3") })).resolves.toEqual({ seconds: 1 });
  });

  it("rejects the current and later requests when the process dies, with its last stderr", async () => {
    await worker!.load("turbo");
    await expect(worker!.synth({ parts: ["CRASH"], voice: "A", out: path.join(dir, "h.mp3") })).rejects.toThrow(/exited.*boom/);
    expect(worker!.closed).toBe(true);
    await expect(worker!.load("turbo")).rejects.toThrow("not running");
  });
});

describe("startTtsWorker", () => {
  it("rejects when the command cannot start", async () => {
    await expect(startTtsWorker({ command: "/nonexistent/python", args: [] })).rejects.toThrow();
  });
});
