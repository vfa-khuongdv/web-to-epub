import { spawn } from "child_process";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { t } from "../lang";
import { MUSIC_FADE_IN, MUSIC_FADE_OUT, runFfmpeg, RunOptions } from "../youtube/video";

/**
 * Renders a composed HyperFrames project to a silent MP4 with the HyperFrames CLI that
 * ships in node_modules (it drives its own headless Chrome and downloads it on first use),
 * then muxes the narration and optional music into it with ffmpeg, so the result is the
 * same kind of file the still-cover render writes.
 */
const FPS = 24;

export function hyperframesBin(): string {
  const manifest = require.resolve("hyperframes/package.json");
  const { bin } = require(manifest) as { bin: Record<string, string> };
  return path.join(path.dirname(manifest), bin.hyperframes);
}

export interface HyperframesRun {
  projectDir: string;
  outPath: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export function renderHyperframes(input: HyperframesRun): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
    const child = spawn(process.execPath, [hyperframesBin(), "render", input.projectDir, "--output", input.outPath, "--fps", String(FPS)], {
      cwd: input.projectDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    let settled = false;
    const onAbort = () => child.kill("SIGKILL");
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const read = (chunk: Buffer) => {
      const text = chunk.toString().replace(/\x1b\[[0-9;]*m/g, "");
      tail = (tail + text).slice(-3000);
      const percents = text.match(/(\d{1,3})%/g);
      const last = percents?.[percents.length - 1];
      if (last) input.onProgress?.(Math.min(1, Number.parseInt(last, 10) / 100));
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    child.on("error", (err) => done(new Error(t("Could not run HyperFrames: {message}", { message: err.message }))));
    child.on("close", (code) => {
      if (code === 0) return done();
      const message = tail.trim().split("\n").filter(Boolean).slice(-3).join(" ");
      done(new Error(t("HyperFrames failed: {message}", { message: message || `exit ${code}` })));
    });
  });
}

export function muxArgs(input: {
  videoPath: string;
  audioPath: string;
  outPath: string;
  seconds: number;
  musicPath?: string;
  musicVolume?: number;
}): string[] {
  const args = ["-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-i", input.videoPath, "-i", input.audioPath];
  if (input.musicPath) {
    const volume = input.musicVolume ?? 0.15;
    args.push(
      "-stream_loop",
      "-1",
      "-i",
      input.musicPath,
      "-filter_complex",
      `[2:a]volume=${volume},afade=t=in:d=${MUSIC_FADE_IN},` +
        `afade=t=out:st=${Math.max(input.seconds - MUSIC_FADE_OUT, 0).toFixed(2)}:d=${MUSIC_FADE_OUT}[m];` +
        "[1:a][m]amix=inputs=2:duration=first:normalize=0[a]",
      "-map",
      "0:v",
      "-map",
      "[a]"
    );
  } else {
    args.push("-map", "0:v", "-map", "1:a");
  }
  args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", input.seconds.toFixed(2), "-movflags", "+faststart", input.outPath);
  return args;
}

export interface RenderProjectInput {
  command: string;
  projectDir: string;
  audioPath: string;
  outPath: string;
  seconds: number;
  musicPath?: string;
  musicVolume?: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  // Test seams: the HyperFrames CLI and the ffmpeg run.
  renderVideo?: (input: HyperframesRun) => Promise<void>;
  run?: (command: string, args: string[], options: RunOptions) => Promise<void>;
}

export async function renderProject(input: RenderProjectInput): Promise<void> {
  const render = input.renderVideo ?? renderHyperframes;
  const run = input.run ?? runFfmpeg;
  await fsPromises.mkdir(path.dirname(input.outPath), { recursive: true });
  const workDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "illustrated-"));
  const silent = path.join(workDir, "silent.mp4");
  const partPath = `${input.outPath}.part.mp4`;
  try {
    // The picture is the long step (about 90% of the time); muxing the sound is quick.
    await render({
      projectDir: input.projectDir,
      outPath: silent,
      signal: input.signal,
      onProgress: (fraction) => input.onProgress?.(fraction * 0.9),
    });
    await run(
      input.command,
      muxArgs({ videoPath: silent, audioPath: input.audioPath, outPath: partPath, seconds: input.seconds, musicPath: input.musicPath, musicVolume: input.musicVolume }),
      { signal: input.signal, onProgress: (fraction) => input.onProgress?.(0.9 + fraction * 0.1), durationSeconds: input.seconds }
    );
    await fsPromises.rename(partPath, input.outPath);
  } finally {
    await fsPromises.rm(workDir, { recursive: true, force: true });
    await fsPromises.rm(partPath, { force: true });
  }
}
