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
 * `text` fingerprints the text the file reads. A file whose text no longer matches is
 * stale — the chapter was edited — and is treated as missing, so an export never ships
 * narration of old text. The model and voice are recorded but do not make a file stale:
 * changing them in Settings applies to chapters narrated from then on, and audio already
 * made keeps playing (deleting a story's audio is how to re-voice it).
 */
export interface NarrationVoice {
  variant: string;
  voice: string;
}

export interface AudioMeta {
  text?: string;
  // Before `text`: one key over text + variant + voice + engine version. Still accepted
  // once, when it matches the current voice, and rewritten as `text` (see readFreshAudio).
  key?: string;
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

// The pre-`text` key, only to recognise audio made before it.
export function legacyNarrationKey(parts: string[], voice: NarrationVoice, engineVersion: string): string {
  return createHash("sha1")
    .update(JSON.stringify([parts, voice.variant, voice.voice, engineVersion]))
    .digest("hex");
}

export async function readFreshAudio(
  dataDir: string,
  storyId: string,
  order: number,
  parts: string[],
  // The voice in Settings now, to recognise (and upgrade) audio saved with the old key.
  legacy?: { voice: NarrationVoice; engineVersion: string }
): Promise<CachedAudio | undefined> {
  let meta: AudioMeta;
  try {
    meta = JSON.parse(await fs.readFile(metaPath(dataDir, storyId, order), "utf8")) as AudioMeta;
  } catch {
    return undefined;
  }
  const text = textKey(parts);
  const fresh =
    meta.text !== undefined
      ? meta.text === text
      : legacy !== undefined && meta.key === legacyNarrationKey(parts, legacy.voice, legacy.engineVersion);
  if (!fresh) return undefined;
  const filePath = chapterAudioPath(dataDir, storyId, order);
  try {
    await fs.access(filePath);
  } catch {
    return undefined;
  }
  if (meta.text === undefined && legacy) {
    const upgraded: AudioMeta = {
      text,
      seconds: meta.seconds ?? 0,
      variant: legacy.voice.variant,
      voice: legacy.voice.voice,
      engine: legacy.engineVersion,
    };
    await fs.writeFile(metaPath(dataDir, storyId, order), JSON.stringify(upgraded)).catch(() => {});
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
