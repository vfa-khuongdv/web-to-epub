import path from "path";
import { DATA_DIR } from "./paths";

// Everything narration installs lives here: the uv binary, the CPython uv fetches, the
// virtualenv with VieNeu, and the model files (HF_HOME). Shared by both libraries — it is
// software, not content — and removed as a whole by "Uninstall".
export const TTS_DIR = path.join(DATA_DIR, "tts");

// Pinned: bumping either is a code change that gets tested, never something the app
// picks up by itself. The cache key of every narrated chapter includes VIENEU_VERSION,
// so a bump regenerates audio rather than mixing voices of two versions in one book.
export const VIENEU_VERSION = "3.8.3";
export const UV_VERSION = "0.12.19";
export const PYTHON_VERSION = "3.12";

// Only these platforms have a uv build we download; anything else reports "unsupported".
const UV_TARGETS: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
};

export function uvDownloadUrl(platform: string = process.platform, arch: string = process.arch): string | undefined {
  const target = UV_TARGETS[`${platform}-${arch}`];
  if (!target) return undefined;
  return `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.tar.gz`;
}

// The worker script ships next to dist/. Inside the packaged Electron app it is unpacked
// out of app.asar (see asarUnpack in package.json) because Python cannot read an asar.
export const WORKER_SCRIPT = path
  .join(__dirname, "..", "..", "tts", "vieneu_worker.py")
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
