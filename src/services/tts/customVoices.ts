import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { CUSTOM_VOICES_DIR } from "../../config/tts";
import { t } from "../lang";
import { BUILTIN_VOICE_PREFIX, VoiceCatalog, voiceCatalog } from "./voiceCatalog";
import { TtsVariant } from "./workerClient";

/**
 * Voices cloned from a clip the user uploads. VieNeu enrolls a voice from any short
 * reference recording (no transcript needed), so a custom voice is just that clip:
 *
 *   <dir>/<id>.<ext>    the clip as uploaded
 *   <dir>/<id>.json     { id, name, file, createdAt, transcript? }
 *   <dir>/<id>.<ext>.*  what an engine derives from the clip (OmniVoice's saved prompt)
 *
 * OmniVoice also clones from what is said in the clip: `transcript` when the user typed
 * it, otherwise the worker has Whisper transcribe the clip once.
 *
 * In settings and on the wire a custom voice is `custom:<id>`, next to the model's own
 * preset ids; the worker enrolls the clip when a synth first asks for it.
 */
export const CUSTOM_VOICE_PREFIX = "custom:";
export const MAX_VOICE_BYTES = 10 * 1024 * 1024;
export const MAX_VOICE_NAME = 60;
export const MAX_VOICE_TRANSCRIPT = 1000;

export interface CustomVoice {
  id: string;
  name: string;
  file: string;
  createdAt: string;
  transcript?: string;
}

// What the worker's soundfile (libsndfile) reads. m4a/aac is not among them.
const FORMATS: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: "wav", test: (b) => b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WAVE" },
  { ext: "flac", test: (b) => b.toString("latin1", 0, 4) === "fLaC" },
  { ext: "ogg", test: (b) => b.toString("latin1", 0, 4) === "OggS" },
  // ID3 tag, or a bare MPEG audio frame sync.
  { ext: "mp3", test: (b) => b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
];

export function audioExtension(bytes: Buffer): string | undefined {
  if (bytes.length < 12) return undefined;
  return FORMATS.find((format) => format.test(bytes))?.ext;
}

const ID_RE = /^[0-9a-f-]{36}$/;

export function createCustomVoices(dir: string, catalog: Pick<VoiceCatalog, "builtin"> = voiceCatalog) {
  const metaPath = (id: string) => path.join(dir, `${id}.json`);

  async function get(id: string): Promise<CustomVoice | undefined> {
    if (!ID_RE.test(id)) return undefined;
    try {
      return JSON.parse(await fs.readFile(metaPath(id), "utf8")) as CustomVoice;
    } catch {
      return undefined;
    }
  }

  return {
    async list(): Promise<CustomVoice[]> {
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        return [];
      }
      const voices = await Promise.all(
        names.filter((name) => name.endsWith(".json")).map((name) => get(name.slice(0, -".json".length)))
      );
      return voices.filter((voice): voice is CustomVoice => voice !== undefined).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    // Throws a user-facing message for a clip that is not audio this app can use.
    async add(name: string, bytes: Buffer, transcript = ""): Promise<CustomVoice> {
      const trimmed = name.trim().slice(0, MAX_VOICE_NAME);
      if (!trimmed) throw new Error(t("Give the voice a name"));
      const said = transcript.trim().replace(/\s+/g, " ");
      if (said.length > MAX_VOICE_TRANSCRIPT) throw new Error(t("The transcript is too long (1000 characters at most)"));
      if (bytes.length > MAX_VOICE_BYTES) throw new Error(t("The voice clip is too large (10 MB at most)"));
      const ext = audioExtension(bytes);
      if (!ext) throw new Error(t("Unsupported audio file — use MP3, WAV, FLAC or OGG"));
      await fs.mkdir(dir, { recursive: true });
      const id = randomUUID();
      const voice: CustomVoice = {
        id,
        name: trimmed,
        file: `${id}.${ext}`,
        createdAt: new Date().toISOString(),
        ...(said ? { transcript: said } : {}),
      };
      await fs.writeFile(path.join(dir, voice.file), bytes);
      // Meta last: a clip without one is not listed.
      await fs.writeFile(metaPath(id), JSON.stringify(voice));
      return voice;
    },

    async remove(id: string): Promise<boolean> {
      const voice = await get(id);
      if (!voice) return false;
      await fs.rm(metaPath(id), { force: true });
      await fs.rm(path.join(dir, voice.file), { force: true });
      for (const name of await fs.readdir(dir)) {
        if (name.startsWith(`${voice.file}.`)) await fs.rm(path.join(dir, name), { force: true });
      }
      return true;
    },

    // The worker's view of a voice id: presets pass through, a custom or built-in one
    // brings its clip. OmniVoice has no voices of its own, so for it a preset (or the
    // default) is refused.
    async synthVoice(
      voice: string,
      variant?: TtsVariant
    ): Promise<{ voice: string; refAudio?: string; refText?: string; refPrompt?: string }> {
      if (voice.startsWith(BUILTIN_VOICE_PREFIX)) {
        const builtin = await catalog.builtin(voice.slice(BUILTIN_VOICE_PREFIX.length));
        if (!builtin) throw new Error(t("This voice is no longer available — pick another in Settings → Narration"));
        return { voice, ...builtin };
      }
      if (!voice.startsWith(CUSTOM_VOICE_PREFIX)) {
        if (variant === "omnivoice") {
          throw new Error(t("OmniVoice has no default voice — pick one in Settings → Narration"));
        }
        return { voice };
      }
      const custom = await get(voice.slice(CUSTOM_VOICE_PREFIX.length));
      if (!custom) throw new Error(t("This custom voice no longer exists — pick another in Settings → Narration"));
      return { voice, refAudio: path.join(dir, custom.file), ...(custom.transcript ? { refText: custom.transcript } : {}) };
    },
  };
}

export type CustomVoices = ReturnType<typeof createCustomVoices>;

export const customVoices = createCustomVoices(CUSTOM_VOICES_DIR);
