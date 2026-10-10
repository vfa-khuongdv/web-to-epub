import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encodeArgs, findFfmpeg, frameArgs, loopClipArgs, renderVideo } from "./video";

describe("ffmpeg arguments", () => {
  it("builds the cover frame filter from the video recipe", () => {
    const args = frameArgs("/cover.jpg", "/frame.png");
    const joined = args.join(" ");
    expect(joined).toContain("boxblur=40:5");
    expect(joined).toContain("scale=-2:900");
    expect(joined).toContain("[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p");
    expect(args.at(-1)).toBe("/frame.png");
  });

  it("mixes the music with fades when a track is given", () => {
    const joined = encodeArgs({
      framePath: "/f.png",
      audioPath: "/a.mp3",
      outPath: "/o.mp4",
      seconds: 60,
      musicPath: "/m.mp3",
      musicVolume: 0.15,
    }).join(" ");
    expect(joined).toContain("-stream_loop -1 -i /m.mp3");
    expect(joined).toContain("volume=0.15");
    expect(joined).toContain("afade=t=in:d=2");
    expect(joined).toContain("afade=t=out:st=56.00:d=4");
    expect(joined).toContain("-t 60.00");
    expect(joined).toContain("-movflags +faststart");
  });

  it("maps the audio alone when there is no music", () => {
    const joined = encodeArgs({ framePath: "/f.png", audioPath: "/a.mp3", outPath: "/o.mp4", seconds: 5 }).join(" ");
    expect(joined).toContain("-map 0:v -map 1:a");
    expect(joined).not.toContain("-filter_complex");
  });
});

describe("moving cover", () => {
  it("draws one seamless clip and loops it without re-encoding the video", () => {
    const clip = loopClipArgs("/cover.jpg", "/loop.mp4").join(" ");
    expect(clip).toContain("sin(2*PI*t/12)");
    expect(clip).toContain("-frames:v 288");
    expect(clip).toContain("open-gop=0");
    const encode = encodeArgs({ framePath: "/loop.mp4", moving: true, audioPath: "/a.mp3", outPath: "/o.mp4", seconds: 60 }).join(" ");
    expect(encode).toContain("-stream_loop -1 -i /loop.mp4");
    expect(encode).toContain("-c:v copy");
    expect(encode).not.toContain("stillimage");
  });
});

describe("findFfmpeg", () => {
  it("returns an explicitly configured executable", () => {
    expect(findFfmpeg(process.execPath)).toBe(process.execPath);
  });
});

describe("renderVideo", () => {
  it("writes the frame, encodes to a part file and renames it into place", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-render-"));
    const calls: string[][] = [];
    await renderVideo({
      command: "/fake/ffmpeg",
      coverPath: path.join(dir, "cover.jpg"),
      audioPath: path.join(dir, "audio.mp3"),
      outPath: path.join(dir, "out.mp4"),
      seconds: 10,
      run: async (_command, args) => {
        calls.push(args);
        fs.writeFileSync(args[args.length - 1], "video");
      },
    });
    expect(calls).toHaveLength(2);
    expect(fs.existsSync(path.join(dir, "out.mp4"))).toBe(true);
    // No part file is left behind.
    expect(fs.readdirSync(dir)).toEqual(["out.mp4"]);
  });
});
