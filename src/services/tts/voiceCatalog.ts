import fs from "fs/promises";
import path from "path";
import { BUNDLED_VOICES_DIR, VOICE_CACHE_DIR } from "../../config/tts";
import { TtsVariant, TtsVoice } from "./workerClient";

/**
 * The voices the app ships with, and a "Preview" for each that was rendered ahead of time,
 * so the settings page lists and plays them without loading a model — or before an engine
 * is even installed:
 *
 *   <bundled>/presets.json               { turbo: TtsVoice[], nano: TtsVoice[] } — VieNeu's own
 *                                        presets, written by src/scripts/renderVoiceSamples.ts
 *   <bundled>/omnivoice.json             BuiltinVoice[] — OmniVoice has no voices of its own,
 *                                        so these are reference clips, edited by hand
 *   <bundled>/clips/<file>               those clips
 *   <bundled>/samples/<variant>/<n>.mp3  PREVIEW_TEXT read by each voice (n: sampleName)
 *
 * A built-in clip voice is `builtin:<id>` in settings and on the wire.
 */
export const BUILTIN_VOICE_PREFIX = "builtin:";

// A sentence of our own for "Preview": short enough to answer in a few seconds on Nano,
// with a tone mark on most syllables so a voice that mangles them is obvious.
export const PREVIEW_TEXT = "Xin chào, đây là giọng đọc thử. Chương một bắt đầu vào một buổi sáng mùa thu.";

export interface BuiltinVoice {
  id: string;
  label: string;
  // Relative to <bundled>/clips.
  clip: string;
  transcript?: string;
}

// Preset ids are display names ("Xuân Vĩnh"); "" is the model's default voice.
export function sampleName(voice: string): string {
  return voice === "" ? "default" : encodeURIComponent(voice);
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    (stat) => stat.isFile(),
    () => false
  );
}

export function createVoiceCatalog(bundledDir: string, cacheDir: string) {
  const builtins = async () => (await readJson<BuiltinVoice[]>(path.join(bundledDir, "omnivoice.json"))) ?? [];

  return {
    // undefined when the render script has not listed this model: ask the model then.
    async presets(variant: TtsVariant): Promise<TtsVoice[] | undefined> {
      if (variant === "omnivoice") return [];
      return (await readJson<Partial<Record<TtsVariant, TtsVoice[]>>>(path.join(bundledDir, "presets.json")))?.[variant];
    },

    builtins,

    // What the worker needs to read with a built-in clip. OmniVoice saves the prompt it
    // derives from a clip next to it unless told otherwise, and the bundled folder is not
    // writable inside the app.
    async builtin(id: string): Promise<{ refAudio: string; refText?: string; refPrompt: string } | undefined> {
      const voice = (await builtins()).find((entry) => entry.id === id);
      if (!voice) return undefined;
      return {
        refAudio: path.join(bundledDir, "clips", voice.clip),
        ...(voice.transcript ? { refText: voice.transcript } : {}),
        refPrompt: path.join(cacheDir, "builtin", `${sampleName(id)}.omnivoice.pt`),
      };
    },

    async bundledSample(variant: TtsVariant, voice: string): Promise<string | undefined> {
      const file = path.join(bundledDir, "samples", variant, `${sampleName(voice)}.mp3`);
      return (await exists(file)) ? file : undefined;
    },

    // Where a preview rendered on this machine is kept. A custom voice's goes next to its
    // clip, so removing the voice removes it too.
    cachedSamplePath(variant: TtsVariant, voice: string, customClip?: string): string {
      if (customClip) return `${customClip}.preview-${variant}.mp3`;
      return path.join(cacheDir, "samples", variant, `${sampleName(voice)}.mp3`);
    },
  };
}

export type VoiceCatalog = ReturnType<typeof createVoiceCatalog>;

export const voiceCatalog = createVoiceCatalog(BUNDLED_VOICES_DIR, VOICE_CACHE_DIR);
