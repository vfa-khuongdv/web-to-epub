import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MusicTrack } from "../backgroundMusic";
import { createMusicMixer } from "./musicMix";

// Stands in for tts/mix_music.py: node plays "python", and the script writes each output
// as "<voice>+<music>@<gain>" so the test can see what it was asked to do.
const FAKE_SCRIPT = `
const fs = require("fs");
const request = JSON.parse(fs.readFileSync(0, "utf8"));
if (request.gain < 0) { process.stderr.write("Traceback\\nValueError: bad gain\\n"); process.exit(1); }
for (const job of request.jobs) {
  fs.writeFileSync(job.out, fs.readFileSync(job.voice, "utf8") + "+" + fs.readFileSync(request.music, "utf8") + "@" + request.gain);
}
`;

const track = (file: string): MusicTrack => ({ id: "t", name: "Track", file, createdAt: "" });

describe("mixMusic", () => {
  let dir: string;
  let script: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "music-mix-test-"));
    script = path.join(dir, "mix.js");
    await fs.writeFile(script, FAKE_SCRIPT);
    await fs.writeFile(path.join(dir, "song.mp3"), "song");
    await fs.writeFile(path.join(dir, "1.mp3"), "voice1");
    await fs.writeFile(path.join(dir, "2.mp3"), "voice2");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function mixer(installed: { vieneu: boolean; omnivoice: boolean }) {
    const runtime = (on: boolean) => ({
      status: async () => ({ supported: true, state: on ? "installed" : "not-installed" }) as never,
      python: on ? process.execPath : "/nonexistent/python",
    });
    return createMusicMixer({
      runtimes: { vieneu: runtime(installed.vieneu), omnivoice: runtime(installed.omnivoice) },
      music: { filePath: (t) => path.join(dir, t.file) },
      script,
    });
  }

  it("mixes every job in one run with the installed engine's Python", async () => {
    const jobs = [
      { voice: path.join(dir, "1.mp3"), out: path.join(dir, "a.mp3") },
      { voice: path.join(dir, "2.mp3"), out: path.join(dir, "b.mp3") },
    ];
    await mixer({ vieneu: false, omnivoice: true })(track("song.mp3"), 0.4, jobs);
    expect(await fs.readFile(jobs[0].out, "utf8")).toBe("voice1+song@0.4");
    expect(await fs.readFile(jobs[1].out, "utf8")).toBe("voice2+song@0.4");
  });

  it("needs an installed engine", async () => {
    await expect(mixer({ vieneu: false, omnivoice: false })(track("song.mp3"), 0.3, [])).rejects.toThrow(
      "needs narration installed"
    );
  });

  it("refuses a track the Python side cannot decode (m4a)", async () => {
    await expect(mixer({ vieneu: true, omnivoice: false })(track("song.m4a"), 0.3, [])).rejects.toThrow("cannot be mixed");
  });

  it("reports the last line of the script's error", async () => {
    await expect(mixer({ vieneu: true, omnivoice: false })(track("song.mp3"), -1, [])).rejects.toThrow(
      "Could not mix the background music: ValueError: bad gain"
    );
  });
});
