import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";

/**
 * Narration audio, one MP3 per chapter, under the library's own data dir — so audio of a
 * private story stays under data/private/ with the story itself.
 *
 *   <dataDir>/audio/<storyId>/<order>.mp3
 *   <dataDir>/audio/<storyId>/<order>.json   { key, seconds }
 *
 * `key` fingerprints what the file was made from (text, variant, voice, VieNeu version).
 * A file whose key no longer matches is stale — the chapter was edited or the voice
 * changed — and is treated as missing, so an export never ships narration of old text.
 */
export interface NarrationVoice {
  variant: string;
  voice: string;
}

export interface CachedAudio {
  filePath: string;
  seconds: number;
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

export function narrationKey(parts: string[], voice: NarrationVoice, engineVersion: string): string {
  return createHash("sha1")
    .update(JSON.stringify([parts, voice.variant, voice.voice, engineVersion]))
    .digest("hex");
}

export async function readFreshAudio(
  dataDir: string,
  storyId: string,
  order: number,
  key: string
): Promise<CachedAudio | undefined> {
  try {
    const meta = JSON.parse(await fs.readFile(metaPath(dataDir, storyId, order), "utf8")) as {
      key?: string;
      seconds?: number;
    };
    if (meta.key !== key) return undefined;
    const filePath = chapterAudioPath(dataDir, storyId, order);
    await fs.access(filePath);
    return { filePath, seconds: meta.seconds ?? 0 };
  } catch {
    return undefined;
  }
}

// Written after the MP3 is complete: a crash mid-synthesis leaves an MP3 without a
// matching key, which reads as missing and gets regenerated.
export async function writeAudioMeta(
  dataDir: string,
  storyId: string,
  order: number,
  key: string,
  seconds: number
): Promise<void> {
  await fs.writeFile(metaPath(dataDir, storyId, order), JSON.stringify({ key, seconds }));
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
