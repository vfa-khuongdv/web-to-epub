import path from "path";
import { DATA_DIR } from "./paths";

// Everything narration installs lives here: the uv binary, the CPython uv fetches, the
// virtualenv with VieNeu, and the model files (HF_HOME). Shared by both libraries — it is
// software, not content — and removed as a whole by "Uninstall".
export const TTS_DIR = path.join(DATA_DIR, "tts");

// Voices the user uploads (a reference clip each). Outside TTS_DIR so uninstalling the
// engine keeps them; shared by both libraries like the engine itself.
export const CUSTOM_VOICES_DIR = path.join(DATA_DIR, "voices");

// Pinned: bumping either is a code change that gets tested, never something the app
// picks up by itself. The cache key of every narrated chapter includes VIENEU_VERSION,
// so a bump regenerates audio rather than mixing voices of two versions in one book.
export const VIENEU_VERSION = "3.8.3";
export const OMNIVOICE_VERSION = "0.2.1";
export const UV_VERSION = "0.12.19";
export const PYTHON_VERSION = "3.12";

// Only these platforms have a uv build we download; anything else reports "unsupported".
const UV_TARGETS: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
};

// OmniVoice is only offered where it runs on the GPU (MPS): on CPU it takes ~17 s per
// second of speech, which no book survives.
export function omnivoiceUvDownloadUrl(platform: string = process.platform, arch: string = process.arch): string | undefined {
  return platform === "darwin" && arch === "arm64" ? uvDownloadUrl(platform, arch) : undefined;
}

export function uvDownloadUrl(platform: string = process.platform, arch: string = process.arch): string | undefined {
  const target = UV_TARGETS[`${platform}-${arch}`];
  if (!target) return undefined;
  return `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.tar.gz`;
}

// The full dependency set VieNeu was tested with, installed as uv constraints: pinning
// only `vieneu` let a newer onnxruntime in, which refuses the Turbo model (see the file).
export const CONSTRAINTS_FILE = path
  .join(__dirname, "..", "..", "tts", "constraints.txt")
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// OmniVoice gets an install of its own next to VieNeu's (its own uv, Python, venv and
// models): it runs on torch, VieNeu on onnxruntime, and their pinned sets do not mix.
// Uninstalling one leaves the other alone.
export const OMNIVOICE_TTS_DIR = path.join(DATA_DIR, "tts-omnivoice");

export const OMNIVOICE_CONSTRAINTS_FILE = path
  .join(__dirname, "..", "..", "tts", "omnivoice-constraints.txt")
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

export const OMNIVOICE_WORKER_SCRIPT = path
  .join(__dirname, "..", "..", "tts", "omnivoice_worker.py")
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// Mixes background music into exported chapters (src/services/tts/musicMix.ts); run with
// an installed engine's Python, unpacked out of app.asar like the workers.
export const MIX_MUSIC_SCRIPT = path
  .join(__dirname, "..", "..", "tts", "mix_music.py")
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// The worker script ships next to dist/. Inside the packaged Electron app it is unpacked
// out of app.asar (see asarUnpack in package.json) because Python cannot read an asar.
export const WORKER_SCRIPT = path
  .join(__dirname, "..", "..", "tts", "vieneu_worker.py")
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// Voices and preview samples that ship with the app (see src/services/tts/voiceSamples.ts):
//   tts/voices/presets.json            VieNeu's preset voices per model, written by the render script
//   tts/voices/omnivoice.json          OmniVoice's built-in voices: a reference clip each (hand-edited)
//   tts/voices/clips/                  those clips
//   tts/voices/samples/<variant>/*.mp3 "Preview" of every voice above, rendered ahead of time
export const BUNDLED_VOICES_DIR = path
  .join(__dirname, "..", "..", "tts", "voices")
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// Previews rendered on this machine (a voice without a bundled sample), and what OmniVoice
// derives from a built-in clip: the bundled folder is read-only inside the app.
export const VOICE_CACHE_DIR = path.join(CUSTOM_VOICES_DIR, "cache");
