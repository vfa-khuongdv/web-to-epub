import { spawn } from "child_process";
import { MIX_MUSIC_SCRIPT } from "../../config/tts";
import { BackgroundMusic, MusicTrack, backgroundMusic } from "../backgroundMusic";
import { t } from "../lang";
import { TTS_ENGINES, TtsEngine, TtsRuntime, ttsRuntimes } from "./runtime";

export interface MixJob {
  voice: string;
  out: string;
}

export interface MusicMixDeps {
  runtimes: Record<TtsEngine, Pick<TtsRuntime, "status" | "python">>;
  music: Pick<BackgroundMusic, "filePath">;
  script: string;
}

// libsndfile, which reads the audio on the Python side, has no AAC decoder.
const MIXABLE = /\.(mp3|wav|flac|ogg)$/;

/**
 * Mixes a background track under narrated chapters (tts/mix_music.py), for exports that
 * ask for it. Runs with whichever engine is installed — there is narration to export, so
 * one is — and one process for the whole batch, so the track is decoded once.
 */
export function createMusicMixer(deps: MusicMixDeps) {
  return async function mixMusic(track: MusicTrack, gain: number, jobs: MixJob[]): Promise<void> {
    if (!MIXABLE.test(track.file)) throw new Error(t("This music cannot be mixed into an export — use an MP3, WAV, FLAC or OGG track"));
    let python: string | undefined;
    for (const engine of TTS_ENGINES) {
      if ((await deps.runtimes[engine].status()).state === "installed") {
        python = deps.runtimes[engine].python;
        break;
      }
    }
    if (!python) throw new Error(t("Mixing background music needs narration installed (Settings → Narration)"));
    const request = JSON.stringify({ music: deps.music.filePath(track), gain, jobs });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(python, [deps.script], { stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-2000);
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(t("Could not mix the background music: {detail}", { detail: stderr.trim().split("\n").pop() ?? `exit ${code}` })));
      });
      child.stdin.end(request);
    });
  };
}

export const mixMusic = createMusicMixer({ runtimes: ttsRuntimes, music: backgroundMusic, script: MIX_MUSIC_SCRIPT });
