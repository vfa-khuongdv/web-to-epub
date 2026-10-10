import { spawn } from "child_process";
import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { t } from "../lang";
import { expandHome } from "./config";

/**
 * The chapter video: the story cover on a blurred copy of itself, 1920×1080, with the
 * chapter MP3 (and optionally the background music) — the same recipe as the workspace's
 * make_video.py, so uploads look like the ones already on the channel. ffmpeg is looked
 * up like the agent binaries are (PATH plus the usual install dirs), since a packaged app
 * starts with a minimal PATH.
 */
const COVER_HEIGHT = 900;
export const MUSIC_FADE_IN = 2;
export const MUSIC_FADE_OUT = 4;

export function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function searchDirs(): string[] {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  dirs.push(
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "C:\\ffmpeg\\bin",
    "C:\\Program Files\\ffmpeg\\bin"
  );
  return [...new Set(dirs)];
}

export function findFfmpeg(configured?: string): string | undefined {
  const explicit = [configured?.trim(), process.env.FFMPEG_PATH?.trim()].filter((value): value is string => Boolean(value));
  for (const file of explicit) {
    const resolved = expandHome(file);
    if (isExecutable(resolved)) return resolved;
  }
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of searchDirs()) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `ffmpeg${extension}`);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

export function requireFfmpeg(configured?: string): string {
  const found = findFfmpeg(configured);
  if (!found) {
    throw new Error(t("ffmpeg was not found. Install it (for example: brew install ffmpeg) or set its path in Settings → YouTube."));
  }
  return found;
}

export function frameArgs(coverPath: string, framePath: string): string[] {
  return [
    "-y",
    "-loglevel",
    "error",
    "-i",
    coverPath,
    "-filter_complex",
    "[0:v]split[a][b];" +
      "[a]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=40:5,eq=brightness=-0.1[bg];" +
      `[b]scale=-2:${COVER_HEIGHT}:flags=lanczos[fg];` +
      "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p",
    "-frames:v",
    "1",
    framePath,
  ];
}

// The moving cover: one short seamless clip (every motion is a sine over exactly one period,
// so its last frame leads back into its first) that the encode loops with `-c:v copy` — the
// video is drawn once, not re-encoded for the whole chapter.
export const LOOP_SECONDS = 12;
const LOOP_FPS = 24;

export function loopClipArgs(coverPath: string, clipPath: string): string[] {
  const w = `2*PI*t/${LOOP_SECONDS}`;
  return [
    "-y",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-framerate",
    String(LOOP_FPS),
    "-i",
    coverPath,
    "-filter_complex",
    // Background: blurred, 10% larger than the frame, panning in a small ellipse.
    "[0:v]split[a][b];" +
      "[a]scale=2112:1188:force_original_aspect_ratio=increase,crop=2112:1188,boxblur=40:5,eq=brightness=-0.1," +
      `crop=1920:1080:x='96+60*sin(${w})':y='54+34*cos(${w})'[bg];` +
      `[b]scale=-2:${COVER_HEIGHT}:flags=lanczos[fg];` +
      // Cover: floats a few pixels up and down, a quarter period behind the background.
      `[bg][fg]overlay=x='(W-w)/2':y='(H-h)/2+16*sin(${w}-PI/2)':eval=frame,format=yuv420p`,
    "-r",
    String(LOOP_FPS),
    "-frames:v",
    String(LOOP_SECONDS * LOOP_FPS),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    // A keyframe every 2 s in closed GOPs, and the first frame of the clip is one: the loop
    // joins cleanly and the file already meets Facebook's video guidance.
    "-g",
    String(LOOP_FPS * 2),
    "-x264-params",
    "open-gop=0",
    clipPath,
  ];
}

export interface EncodeInput {
  framePath: string;
  // `framePath` is a looping clip (see loopClipArgs) rather than a still frame.
  moving?: boolean;
  audioPath: string;
  outPath: string;
  seconds: number;
  musicPath?: string;
  musicVolume?: number;
}

export function encodeArgs(input: EncodeInput): string[] {
  const args = [
    "-y",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    "-nostats",
    ...(input.moving ? ["-stream_loop", "-1"] : ["-loop", "1", "-framerate", "1"]),
    "-i",
    input.framePath,
    "-i",
    input.audioPath,
  ];
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
  args.push(
    ...(input.moving ? ["-c:v", "copy"] : ["-c:v", "libx264", "-tune", "stillimage", "-crf", "18", "-r", "1"]),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    input.seconds.toFixed(2),
    "-movflags",
    "+faststart",
    input.outPath
  );
  return args;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  durationSeconds?: number;
}

export function runFfmpeg(command: string, args: string[], options: RunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    let settled = false;
    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      child.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (!options.onProgress || !options.durationSeconds) return;
      stdout = (stdout + chunk.toString()).slice(-2000);
      // ffmpeg's -progress lines carry out_time_us (microseconds).
      const matches = stdout.match(/out_time_us=(\d+)/g);
      const last = matches?.[matches.length - 1];
      if (!last) return;
      const seconds = Number(last.split("=")[1]) / 1_000_000;
      if (Number.isFinite(seconds)) options.onProgress(Math.max(0, Math.min(1, seconds / options.durationSeconds)));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(t("Could not run ffmpeg: {message}", { message: err.message })));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }
      const tail = stderr.trim().split("\n").filter(Boolean).slice(-3).join(" ");
      reject(new Error(t("ffmpeg failed: {message}", { message: tail || `exit ${code}` })));
    });
  });
}

export interface RenderVideoInput {
  command: string;
  coverPath: string;
  audioPath: string;
  outPath: string;
  seconds: number;
  musicPath?: string;
  musicVolume?: number;
  // A cover that drifts gently in a loop instead of one still frame. Off for the hours-long
  // compilations, where the encode below would have to run for the whole length.
  motion?: boolean;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  // Test seam: the two ffmpeg runs, replaced by a fake in tests.
  run?: (command: string, args: string[], options: RunOptions) => Promise<void>;
}

export async function renderVideo(input: RenderVideoInput): Promise<void> {
  const run = input.run ?? runFfmpeg;
  await fsPromises.mkdir(path.dirname(input.outPath), { recursive: true });
  const workDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "yt-frame-"));
  const framePath = path.join(workDir, input.motion ? "loop.mp4" : "frame.png");
  const partPath = `${input.outPath}.part.mp4`;
  try {
    await run(input.command, input.motion ? loopClipArgs(input.coverPath, framePath) : frameArgs(input.coverPath, framePath), {});
    await run(
      input.command,
      encodeArgs({
        framePath,
        moving: input.motion,
        audioPath: input.audioPath,
        outPath: partPath,
        seconds: input.seconds,
        musicPath: input.musicPath,
        musicVolume: input.musicVolume,
      }),
      { signal: input.signal, onProgress: input.onProgress, durationSeconds: input.seconds }
    );
    // Renamed only when the whole file is there: a killed render leaves no half video.
    await fsPromises.rename(partPath, input.outPath);
  } finally {
    await fsPromises.rm(workDir, { recursive: true, force: true });
    await fsPromises.rm(partPath, { force: true });
  }
}
