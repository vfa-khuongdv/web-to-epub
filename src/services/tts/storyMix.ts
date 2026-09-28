import { spawn } from "child_process";
import { t } from "../lang";

export interface StoryMixInput {
  chapters: string[];
  // Background music looped under the narration; none leaves it narration only.
  music?: string;
  musicVolume: number;
  out: string;
}

export interface MixCommand {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

/**
 * Join chapter MP3s into one file with tts/mix_story.py (run by an engine's Python):
 * the job goes in as JSON on stdin, progress comes back as JSON lines. Resolves with the
 * length of the result in seconds.
 */
export function mixStoryAudio(
  cmd: MixCommand,
  input: StoryMixInput,
  onProgress: (done: number, total: number) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, {
      env: { ...process.env, ...cmd.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let stderr = "";
    let seconds: number | undefined;
    let failure: string | undefined;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        let message: { type?: string; done?: number; total?: number; seconds?: number; message?: string };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type === "progress") onProgress(message.done ?? 0, message.total ?? 0);
        else if (message.type === "done") seconds = message.seconds ?? 0;
        else if (message.type === "error") failure = message.message;
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0 && seconds !== undefined) resolve(seconds);
      else reject(new Error(t("Could not join the audio: {message}", { message: failure ?? (stderr.trim() || `exit ${code}`) })));
    });
    child.stdin.end(JSON.stringify(input));
  });
}
