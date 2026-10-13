import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { facebookArgs, facebookProblems, prepareForFacebook, VideoInfo } from "./normalize";

const good: VideoInfo = {
  videoCodec: "h264",
  profile: "High",
  pixFmt: "yuv420p",
  fps: 30,
  maxKeyframeGap: 2,
  audioCodec: "aac",
  channels: 2,
  sampleRate: 48000,
  audioBitrate: 160_000,
};

// What the still-cover render writes today: this is the file Facebook sent feedback on.
const stillCover: VideoInfo = {
  videoCodec: "h264",
  profile: "High 4:4:4 Predictive",
  pixFmt: "yuv444p",
  fps: 1,
  maxKeyframeGap: 250,
  audioCodec: "aac",
  channels: 1,
  sampleRate: 24000,
  audioBitrate: 90_000,
};

describe("facebookProblems", () => {
  it("accepts a file that follows the guidance", () => {
    expect(facebookProblems(good)).toEqual([]);
  });

  it("names every way the still-cover video misses it", () => {
    const problems = facebookProblems(stillCover).join(" | ");
    expect(problems).toContain("yuv444p");
    expect(problems).toContain("profile High 4:4:4 Predictive");
    expect(problems).toContain("frame rate 1");
    expect(problems).toContain("250 s apart");
    expect(problems).toContain("1 audio channel");
    expect(problems).toContain("24000 Hz");
    expect(problems).toContain("under 128 kbps");
  });

  it.each([
    ["a missing audio track", { audioCodec: undefined, channels: undefined, sampleRate: undefined, audioBitrate: undefined }],
    ["44.1 kHz stereo (allowed)", { sampleRate: 44100 }],
    ["60 fps (allowed)", { fps: 60 }],
  ])("%s", (name, patch) => {
    const problems = facebookProblems({ ...good, ...patch });
    expect(problems.length > 0).toBe(name === "a missing audio track");
  });

  it("refuses a keyframe gap over 5 s and an unknown one", () => {
    expect(facebookProblems({ ...good, maxKeyframeGap: 6 })).toHaveLength(1);
    expect(facebookProblems({ ...good, maxKeyframeGap: undefined })).toHaveLength(1);
    expect(facebookProblems({ ...good, maxKeyframeGap: 5 })).toEqual([]);
  });
});

describe("facebookArgs", () => {
  it("makes 4:2:0 High profile H.264, a closed 4 s GOP at 30 fps, stereo 48 kHz AAC and faststart for a 1 fps still", () => {
    const args = facebookArgs({ file: "in.mp4", outPath: "out.mp4", sourceFps: 1 });
    const text = args.join(" ");
    expect(text).toContain("-vf fps=30,format=yuv420p");
    expect(text).toContain("-profile:v high");
    expect(text).toContain("-g 120 -keyint_min 120 -sc_threshold 0");
    expect(text).toContain("open-gop=0");
    expect(text).toContain("-tune stillimage");
    expect(text).toContain("-ar 48000 -ac 2");
    expect(text).toContain("+faststart");
    expect(args[args.length - 1]).toBe("out.mp4");
  });

  it("keeps a frame rate that is already in range and uses a 2 s GOP for moving pictures", () => {
    const text = facebookArgs({ file: "in.mp4", outPath: "o.mp4", sourceFps: 24 }).join(" ");
    expect(text).toContain("fps=24");
    expect(text).toContain("-g 48");
    expect(text).not.toContain("stillimage");
  });
});

describe("prepareForFacebook", () => {
  it("uses the file as it is when it already follows the guidance", async () => {
    let ran = false;
    const prepared = await prepareForFacebook({
      file: "/x/1.mp4",
      ffmpeg: "ffmpeg",
      probe: async () => good,
      run: async () => void (ran = true),
    });
    expect(prepared).toMatchObject({ path: "/x/1.mp4", converted: false });
    expect(ran).toBe(false);
  });

  it("makes a copy next to the file for one that does not, and removes it on cleanup", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-norm-"));
    const file = path.join(dir, "1.mp4");
    await fs.writeFile(file, "video");
    const progress: number[] = [];
    const prepared = await prepareForFacebook({
      file,
      ffmpeg: "ffmpeg",
      probe: async () => ({ ...stillCover, durationSeconds: 60 }),
      run: async (_command, args, options) => {
        expect(args.join(" ")).toContain("-i " + file);
        options.onProgress?.(0.5);
        await fs.writeFile(args[args.length - 1], "converted");
      },
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(prepared.converted).toBe(true);
    expect(path.dirname(prepared.path)).toBe(dir);
    expect(prepared.path).not.toBe(file);
    expect(await fs.readFile(prepared.path, "utf8")).toBe("converted");
    expect(progress).toEqual([0.5]);
    await prepared.cleanup();
    await expect(fs.stat(prepared.path)).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe("video");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("converts a file it cannot read, and leaves no half copy when ffmpeg fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-norm-"));
    const file = path.join(dir, "1.mp4");
    await fs.writeFile(file, "video");
    await expect(
      prepareForFacebook({
        file,
        ffmpeg: "ffmpeg",
        probe: async () => {
          throw new Error("no ffprobe");
        },
        run: async (_c, args) => {
          await fs.writeFile(args[args.length - 1], "half");
          throw new Error("ffmpeg failed");
        },
      })
    ).rejects.toThrow("ffmpeg failed");
    expect((await fs.readdir(dir)).filter((name) => name.startsWith(".facebook-"))).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
