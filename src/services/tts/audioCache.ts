import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";

/**
 * Narration audio, one MP3 per chapter, under the library's own data dir — so audio of a
 * private story stays under data/private/ with the story itself.
 *
 *   <dataDir>/audio/<storyId>/<order>.mp3
 *   <dataDir>/audio/<storyId>/<order>.json   AudioMeta
 *
 * Audio once made is kept: editing the chapter (fixing a typo, re-splitting a paragraph)
 * does not throw it away, and neither does changing the model or voice in Settings.
 * Re-narrating a chapter ("Regenerate audio") or deleting a story's audio replaces it.
 * `text` records what the file reads; it is not compared against the chapter.
 */
export interface NarrationVoice {
  variant: string;
  voice: string;
}

export interface AudioMeta {
  text?: string;
  seconds: number;
  variant?: string;
  voice?: string;
  engine?: string;
  // [start, end] in seconds of each part, in chapterParts order (absent on older audio).
  timings?: [number, number][];
}

export interface CachedAudio {
  filePath: string;
  seconds: number;
  timings?: [number, number][];
}

export function storyAudioDir(dataDir: string, storyId: string): string {
  return path.join(dataDir, "audio", storyId);
}

export function chapterAudioPath(dataDir: string, storyId: string, order: number): string {
  return path.join(storyAudioDir(dataDir, storyId), `${order}.mp3`);
}

function metaPath(dataDir: string, storyId: string, order: number): string {
  return path.join(storyAudioDir(dataDir, storyId), `${order}.json`);
}

export function textKey(parts: string[]): string {
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

// The audio of a chapter, whatever text it now has. A meta file is the sign the MP3 is
// complete (see writeAudioMeta).
export async function readChapterAudio(dataDir: string, storyId: string, order: number): Promise<CachedAudio | undefined> {
  let meta: AudioMeta;
  try {
    meta = JSON.parse(await fs.readFile(metaPath(dataDir, storyId, order), "utf8")) as AudioMeta;
  } catch {
    return undefined;
  }
  const filePath = chapterAudioPath(dataDir, storyId, order);
  try {
    await fs.access(filePath);
  } catch {
    return undefined;
  }
  return { filePath, seconds: meta.seconds ?? 0, timings: meta.timings };
}

// Written after the MP3 is complete: a crash mid-synthesis leaves an MP3 without a
// matching meta, which reads as missing and gets regenerated.
export async function writeAudioMeta(
  dataDir: string,
  storyId: string,
  order: number,
  parts: string[],
  info: { seconds: number; voice: NarrationVoice; engineVersion: string; timings?: [number, number][] }
): Promise<void> {
  const meta: AudioMeta = {
    text: textKey(parts),
    seconds: info.seconds,
    variant: info.voice.variant,
    voice: info.voice.voice,
    engine: info.engineVersion,
    timings: info.timings,
  };
  await fs.writeFile(metaPath(dataDir, storyId, order), JSON.stringify(meta));
}

export async function ensureStoryAudioDir(dataDir: string, storyId: string): Promise<void> {
  await fs.mkdir(storyAudioDir(dataDir, storyId), { recursive: true });
}

export async function removeStoryAudio(dataDir: string, storyId: string): Promise<void> {
  await fs.rm(storyAudioDir(dataDir, storyId), { recursive: true, force: true });
}

export async function storyAudioBytes(dataDir: string, storyId: string): Promise<number> {
  try {
    const dir = storyAudioDir(dataDir, storyId);
    const names = await fs.readdir(dir);
    const sizes = await Promise.all(names.map(async (name) => (await fs.stat(path.join(dir, name))).size));
    return sizes.reduce((sum, size) => sum + size, 0);
  } catch {
    return 0;
  }
}
