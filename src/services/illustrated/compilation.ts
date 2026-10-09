import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { AgentModel } from "../agent/agentConfig";
import { t } from "../lang";
import { ContentBlock } from "../../types";
import { chapterParts } from "../tts/chapterText";
import { MUSIC_FADE_IN, MUSIC_FADE_OUT, runFfmpeg, RunOptions } from "../youtube/video";
import { composeStillProject } from "./compose";
import { hyperframesBin } from "./render";
import { partWindows, readStoryboard, saveStoryboard, splitLongScenes, storyboardKey, timeScenes, writeStoryboard } from "./storyboard";
import { Bible, TimedScene } from "./types";

/**
 * Illustrated compilation: a compilation is hours long, so it is not animated (a frame-by-
 * frame render would take days). Each chapter contributes one or two still scenes — picked
 * from the chapter's own storyboard, the one a chapter video would use — shown for as long
 * as that half of the chapter plays, with the chapter number in a corner. The stills are
 * snapshotted by HyperFrames in batches (one Chrome start per batch) and ffmpeg joins them
 * with the narration like the cover compilation does.
 */
const BATCH = 40;
// Under this the chapter gets one slide; a long one gets two, one per half.
const TWO_SLIDES_FROM_SECONDS = 90;

export interface ChapterInput {
  order: number;
  title: string;
  blocks: ContentBlock[];
  seconds: number;
  timings?: [number, number][];
}

export interface Slide {
  order: number;
  scene: TimedScene;
  seconds: number;
}

// The scene closest to `at` seconds into the chapter, preferring one with a character in it
// (a slide of empty scenery says little about the story).
function sceneNear(scenes: TimedScene[], at: number): TimedScene {
  const withCast = scenes.filter((scene) => scene.cast.length > 0);
  const pool = withCast.length > 0 ? withCast : scenes;
  const distance = (scene: TimedScene) => (at >= scene.from && at < scene.to ? 0 : Math.min(Math.abs(at - scene.from), Math.abs(at - scene.to)));
  return pool.reduce((best, scene) => (distance(scene) < distance(best) ? scene : best));
}

export function pickSlides(order: number, seconds: number, scenes: TimedScene[]): Slide[] {
  if (scenes.length === 0) return [];
  if (seconds < TWO_SLIDES_FROM_SECONDS) return [{ order, scene: sceneNear(scenes, seconds / 2), seconds }];
  return [
    { order, scene: sceneNear(scenes, seconds * 0.25), seconds: seconds / 2 },
    { order, scene: sceneNear(scenes, seconds * 0.75), seconds: seconds / 2 },
  ];
}

export function slideshowArgs(input: {
  listFile: string;
  audioPath: string;
  outPath: string;
  seconds: number;
  musicPath?: string;
  musicVolume?: number;
}): string[] {
  const args = ["-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-f", "concat", "-safe", "0", "-i", input.listFile, "-i", input.audioPath];
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
    "-vf",
    "fps=1,format=yuv420p",
    "-c:v",
    "libx264",
    "-tune",
    "stillimage",
    "-crf",
    "18",
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

// The concat demuxer takes a duration per picture, and ignores the last one unless the
// file is listed again.
export function slideshowList(files: { file: string; seconds: number }[]): string {
  const quote = (file: string) => `file '${file.replace(/'/g, "'\\''")}'`;
  const lines = files.flatMap(({ file, seconds }) => [quote(file), `duration ${seconds.toFixed(3)}`]);
  if (files.length > 0) lines.push(quote(files[files.length - 1].file));
  return `${lines.join("\n")}\n`;
}

export type SnapshotStills = (input: { projectDir: string; outDir: string; count: number; signal?: AbortSignal }) => Promise<string[]>;

// `hyperframes snapshot --at 0.5,1.5,…`: the project lays slide i at second i, so the
// frames come back in slide order.
export const snapshotStills: SnapshotStills = ({ projectDir, outDir, count, signal }) =>
  new Promise((resolve, reject) => {
    const env = { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
    const at = Array.from({ length: count }, (_, index) => `${index}.5`).join(",");
    const child = spawn(process.execPath, [hyperframesBin(), "snapshot", projectDir, "--at", at, "--no-end", "-o", outDir], {
      cwd: projectDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    const read = (chunk: Buffer) => {
      tail = (tail + chunk.toString().replace(/\x1b\[[0-9;]*m/g, "")).slice(-3000);
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.on("error", (err) => reject(new Error(t("Could not run HyperFrames: {message}", { message: err.message }))));
    child.on("close", async (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(new Error(t("HyperFrames failed: {message}", { message: tail.trim().split("\n").filter(Boolean).slice(-3).join(" ") || `exit ${code}` })));
        return;
      }
      const files = (await fs.readdir(outDir)).filter((name) => /^frame-\d+-.*\.png$/.test(name)).sort();
      resolve(files.slice(0, count).map((name) => path.join(outDir, name)));
    });
  });

export interface IllustratedCompilationInput {
  dataDir: string;
  storyId: string;
  storyTitle: string;
  bible: Bible;
  chapters: ChapterInput[];
  // None = chapters need a storyboard made before.
  agent?: AgentModel;
  command: string;
  // The part's narration, already joined.
  audioPath: string;
  seconds: number;
  outPath: string;
  musicPath?: string;
  musicVolume?: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  // Test seams.
  snapshot?: SnapshotStills;
  run?: (command: string, args: string[], options: RunOptions) => Promise<void>;
}

async function scenesOf(input: IllustratedCompilationInput, chapter: ChapterInput): Promise<TimedScene[]> {
  const parts = chapterParts(chapter.title, chapter.blocks);
  if (parts.length === 0) throw new Error(t("Chapter {order} has no text to illustrate", { order: chapter.order }));
  const windows = partWindows(parts, chapter.seconds, chapter.timings);
  const key = storyboardKey(input.bible, parts);
  let scenes = await readStoryboard(input.dataDir, input.storyId, chapter.order, key);
  if (!scenes) {
    if (!input.agent) throw new Error(t("Illustrated videos need the agent (Settings → Agent crawler) to plan the scenes"));
    scenes = splitLongScenes(
      await writeStoryboard(input.agent, {
        storyTitle: input.storyTitle,
        bible: input.bible,
        parts,
        windows,
        seconds: chapter.seconds,
        signal: input.signal,
      }),
      windows,
      chapter.seconds
    );
    await saveStoryboard(input.dataDir, input.storyId, chapter.order, key, scenes);
  }
  return timeScenes(scenes, parts, windows, chapter.seconds);
}

export async function renderIllustratedCompilation(input: IllustratedCompilationInput): Promise<void> {
  const snapshot = input.snapshot ?? snapshotStills;
  const run = input.run ?? runFfmpeg;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "illustrated-compilation-"));
  const partPath = `${input.outPath}.part.mp4`;
  try {
    // 1. Planning is the slow, agent-bound step and is saved per chapter, so a stopped
    //    run starts again from where it was. Planning is 0–40 %, stills 40–70 %, joining 70–100 %.
    const slides: Slide[] = [];
    for (const [index, chapter] of input.chapters.entries()) {
      if (input.signal?.aborted) throw new Error(t("Stopped"));
      slides.push(...pickSlides(chapter.order, chapter.seconds, await scenesOf(input, chapter)));
      input.onProgress?.(((index + 1) / input.chapters.length) * 0.4);
    }
    // 2. The stills.
    const pictures: { file: string; seconds: number }[] = [];
    for (let start = 0; start < slides.length; start += BATCH) {
      if (input.signal?.aborted) throw new Error(t("Stopped"));
      const batch = slides.slice(start, start + BATCH);
      const projectDir = path.join(workDir, `batch-${start}`);
      const outDir = path.join(workDir, `stills-${start}`);
      await fs.mkdir(outDir, { recursive: true });
      await composeStillProject(
        projectDir,
        input.bible,
        batch.map((slide) => ({ scene: slide.scene, badge: t("Chapter {order}", { order: slide.order }) }))
      );
      const files = await snapshot({ projectDir, outDir, count: batch.length, signal: input.signal });
      if (files.length !== batch.length) throw new Error(t("HyperFrames failed: {message}", { message: "missing frames" }));
      batch.forEach((slide, index) => pictures.push({ file: files[index], seconds: slide.seconds }));
      input.onProgress?.(0.4 + Math.min(1, (start + batch.length) / slides.length) * 0.3);
    }
    // 3. Join the pictures with the narration.
    const listFile = path.join(workDir, "slides.txt");
    await fs.writeFile(listFile, slideshowList(pictures));
    await fs.mkdir(path.dirname(input.outPath), { recursive: true });
    await run(
      input.command,
      slideshowArgs({ listFile, audioPath: input.audioPath, outPath: partPath, seconds: input.seconds, musicPath: input.musicPath, musicVolume: input.musicVolume }),
      { signal: input.signal, durationSeconds: input.seconds, onProgress: (fraction) => input.onProgress?.(0.7 + fraction * 0.3) }
    );
    await fs.rename(partPath, input.outPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(partPath, { force: true });
  }
}
