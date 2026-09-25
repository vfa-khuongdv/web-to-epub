import { ChildProcess, spawn } from "child_process";
import { randomUUID } from "crypto";
import readline from "readline";

/**
 * Client for tts/vieneu_worker.py: one child process, JSON lines both ways (see the
 * protocol at the top of that file). Requests are served one at a time — synthesis is
 * CPU-bound and the worker is single-threaded — so they are queued here and the next
 * one is written only when the previous one has answered.
 */
export const TTS_VARIANTS = ["turbo", "nano"] as const;
export type TtsVariant = (typeof TTS_VARIANTS)[number];

export interface TtsVoice {
  id: string;
  label: string;
}

export interface LoadedModel {
  variant: TtsVariant;
  voices: TtsVoice[];
  sampleRate: number;
}

export interface SynthRequest {
  parts: string[];
  voice: string;
  out: string;
  onProgress?: (part: number, parts: number) => void;
  signal?: AbortSignal;
}

export class NarrationCancelled extends Error {
  constructor() {
    super("Narration cancelled");
    this.name = "NarrationCancelled";
  }
}

interface WorkerMessage {
  type: "ready" | "loaded" | "progress" | "done" | "cancelled" | "error";
  id?: string | null;
  message?: string;
  part?: number;
  parts?: number;
  seconds?: number;
  variant?: TtsVariant;
  voices?: TtsVoice[];
  sampleRate?: number;
}

export interface WorkerCommand {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export interface TtsWorker {
  load(variant: TtsVariant): Promise<LoadedModel>;
  synth(request: SynthRequest): Promise<{ seconds: number }>;
  close(): void;
  readonly closed: boolean;
}

export function startTtsWorker(cmd: WorkerCommand, log: (line: string) => void = () => {}): Promise<TtsWorker> {
  const child: ChildProcess = spawn(cmd.command, cmd.args, {
    env: { ...process.env, ...cmd.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let closed = false;
  // The request being served; only it receives the worker's lines.
  let current: ((message: WorkerMessage) => void) | undefined;
  let failCurrent: ((err: Error) => void) | undefined;
  let tail: Promise<unknown> = Promise.resolve();

  const stderrTail: string[] = [];
  readline.createInterface({ input: child.stderr! }).on("line", (line) => {
    stderrTail.push(line);
    if (stderrTail.length > 20) stderrTail.shift();
    log(line);
  });

  let onReady: (() => void) | undefined;
  let onReadyFail: ((err: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    onReady = resolve;
    onReadyFail = reject;
  });

  readline.createInterface({ input: child.stdout! }).on("line", (line) => {
    let message: WorkerMessage;
    try {
      message = JSON.parse(line);
    } catch {
      log(line);
      return;
    }
    if (message.type === "ready") onReady?.();
    else current?.(message);
  });

  const exited = (reason: string) => {
    if (closed) return;
    closed = true;
    const detail = stderrTail.slice(-3).join(" | ");
    const err = new Error(detail ? `${reason}: ${detail}` : reason);
    onReadyFail?.(err);
    failCurrent?.(err);
  };
  child.on("error", (err) => exited(err.message));
  child.on("exit", (code, signal) => exited(`TTS worker exited (${signal ?? code})`));

  function send(payload: object) {
    child.stdin!.write(`${JSON.stringify(payload)}\n`);
  }

  // Serve one request: write it, feed it lines until `handle` settles it.
  function request<T>(
    payload: object,
    handle: (message: WorkerMessage, resolve: (value: T) => void, reject: (err: Error) => void) => void
  ): Promise<T> {
    const run = () =>
      new Promise<T>((resolve, reject) => {
        if (closed) {
          reject(new Error("TTS worker is not running"));
          return;
        }
        const settle = () => {
          current = undefined;
          failCurrent = undefined;
        };
        current = (message) =>
          handle(
            message,
            (value) => {
              settle();
              resolve(value);
            },
            (err) => {
              settle();
              reject(err);
            }
          );
        failCurrent = (err) => {
          settle();
          reject(err);
        };
        send(payload);
      });
    const result = tail.then(run, run);
    tail = result.catch(() => {});
    return result;
  }

  const worker: TtsWorker = {
    get closed() {
      return closed;
    },
    load(variant) {
      return request<LoadedModel>({ cmd: "load", variant }, (message, resolve, reject) => {
        if (message.type === "loaded") {
          resolve({ variant: message.variant ?? variant, voices: message.voices ?? [], sampleRate: message.sampleRate ?? 0 });
        } else if (message.type === "error") {
          reject(new Error(message.message ?? "TTS load failed"));
        }
      });
    },
    synth({ parts, voice, out, onProgress, signal }) {
      if (signal?.aborted) return Promise.reject(new NarrationCancelled());
      const id = randomUUID();
      let onAbort: (() => void) | undefined;
      const promise = request<{ seconds: number }>(
        { cmd: "synth", id, parts, voice, out },
        (message, resolve, reject) => {
          if (message.id !== id) return;
          if (message.type === "progress") onProgress?.(message.part ?? 0, message.parts ?? parts.length);
          else if (message.type === "done") resolve({ seconds: message.seconds ?? 0 });
          else if (message.type === "cancelled") reject(new NarrationCancelled());
          else if (message.type === "error") reject(new Error(message.message ?? "TTS synthesis failed"));
        }
      );
      if (signal) {
        onAbort = () => {
          if (!closed) send({ cmd: "cancel", id });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        promise.finally(() => signal.removeEventListener("abort", onAbort!)).catch(() => {});
      }
      return promise;
    },
    close() {
      if (closed) return;
      try {
        send({ cmd: "quit" });
        child.stdin!.end();
      } catch {
        /* already gone */
      }
      // Give it a moment to exit on its own, then make sure.
      setTimeout(() => {
        if (child.exitCode === null) child.kill();
      }, 2000).unref();
    },
  };

  return ready.then(() => worker);
}
