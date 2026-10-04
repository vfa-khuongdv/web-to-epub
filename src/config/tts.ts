import { execFileSync } from "child_process";
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
  "win32-x64": "x86_64-pc-windows-msvc",
};

let nvidiaGpu: boolean | undefined;
// True when an NVIDIA driver answers (nvidia-smi ships with it). Checked once.
export function hasNvidiaGpu(): boolean {
  if (nvidiaGpu === undefined) {
    try {
      execFileSync("nvidia-smi", ["-L"], { stdio: "ignore", timeout: 5000 });
      nvidiaGpu = true;
    } catch {
      nvidiaGpu = false;
    }
  }
  return nvidiaGpu;
}

// OmniVoice is only offered where it runs on a GPU: Metal (Apple Silicon) or CUDA (an NVIDIA
// card on Windows/Linux x64). On CPU it takes ~17 s per second of speech, which no book survives.
export function omnivoiceUvDownloadUrl(
  platform: string = process.platform,
  arch: string = process.arch,
  nvidia: () => boolean = hasNvidiaGpu
): string | undefined {
  if (platform === "darwin") return arch === "arm64" ? uvDownloadUrl(platform, arch) : undefined;
  return (platform === "linux" || platform === "win32") && arch === "x64" && nvidia() ? uvDownloadUrl(platform, arch) : undefined;
}

// CUDA build of torch for Windows/Linux, from PyTorch's own index (PyPI's Windows wheel is
// CPU-only). cu126 runs on drivers from 2024 on; macOS uses the plain PyPI wheel (Metal).
export const TORCH_CUDA_TAG = "cu126";
export const TORCH_CUDA_INDEX = `https://download.pytorch.org/whl/${TORCH_CUDA_TAG}`;

export function uvDownloadUrl(platform: string = process.platform, arch: string = process.arch): string | undefined {
  const target = UV_TARGETS[`${platform}-${arch}`];
  if (!target) return undefined;
  return `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.${platform === "win32" ? "zip" : "tar.gz"}`;
}

// Windows: onnxruntime, soxr and kaldi-native-fbank link msvcp140*.dll (the Visual C++
// runtime), which uv's Python does not ship (only vcruntime140*.dll) and a fresh Windows does
// not have — without it the model fails to load with "DLL load failed". This package puts the
// DLLs in the venv, which needs no admin rights; the Python scripts add that folder to their
// DLL search path (`add_dll_directory`), since the venv's python.exe is only a launcher.
export function msvcRuntimePackages(platform: string = process.platform): string[] {
  return platform === "win32" ? ["msvc-runtime==14.44.35112"] : [];
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

// The worker script ships next to dist/. Inside the packaged Electron app it is unpacked
// out of app.asar (see asarUnpack in package.json) because Python cannot read an asar.
export const WORKER_SCRIPT = path
  .join(__dirname, "..", "..", "tts", "vieneu_worker.py")
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// Joins a story's chapter MP3s into one file with background music (audio export).
// Unpacked out of app.asar like the workers, and run with an engine's Python.
export const MIX_SCRIPT = path
  .join(__dirname, "..", "..", "tts", "mix_story.py")
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
