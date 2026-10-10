import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { t } from "../lang";
import { loadYouTubeConfig } from "../youtube/config";
import { findFfmpeg, runFfmpeg, RunOptions } from "../youtube/video";

const execFileAsync = promisify(execFile);

/**
 * Facebook's own encoding guidance for an uploaded video (Meta's Page video docs): H.264
 * with 4:2:0 chroma, progressive, a fixed frame rate of 24–60 (30 or less for the feed), a
 * closed GOP with a keyframe every 2–5 s, AAC-LC stereo at 44.1/48 kHz and 128 kbps or more,
 * and the moov atom first. The still-cover and slideshow renders are made for YouTube, which
 * accepts almost anything (1 fps, one keyframe per 250 s, mono 24 kHz audio, 4:4:4 chroma),
 * and Facebook sends such a file back with feedback. So every video is checked just before it
 * goes to the Page and, if it does not meet the guidance, re-encoded into a temporary copy.
 */
export interface VideoInfo {
  videoCodec?: string;
  profile?: string;
  pixFmt?: string;
  fps?: number;
  // Seconds between keyframes, the largest gap seen near the start of the file.
  maxKeyframeGap?: number;
  audioCodec?: string;
  channels?: number;
  sampleRate?: number;
  // bits per second
  audioBitrate?: number;
  durationSeconds?: number;
}

const MAX_KEYFRAME_GAP = 5.1;
const MIN_AUDIO_BITRATE = 120_000;
const GOOD_PROFILES = new Set(["baseline", "constrained baseline", "main", "high"]);

// What in the file Facebook would object to; empty when it already follows the guidance.
export function facebookProblems(info: VideoInfo): string[] {
  const problems: string[] = [];
  if (info.videoCodec !== "h264") problems.push("video is not H.264");
  if (info.pixFmt !== "yuv420p") problems.push(`chroma ${info.pixFmt ?? "unknown"} instead of 4:2:0`);
  if (!GOOD_PROFILES.has((info.profile ?? "").toLowerCase())) problems.push(`H.264 profile ${info.profile ?? "unknown"}`);
  if (!info.fps || info.fps < 24 || info.fps > 60) problems.push(`frame rate ${info.fps ?? "unknown"} outside 24–60`);
  if (info.maxKeyframeGap === undefined || info.maxKeyframeGap > MAX_KEYFRAME_GAP) {
    problems.push(`keyframes ${info.maxKeyframeGap === undefined ? "unknown" : `${Math.round(info.maxKeyframeGap)} s apart`}, need 2–5 s`);
  }
  if (info.audioCodec !== "aac") problems.push("audio is not AAC");
  if (info.channels !== 2) problems.push(`${info.channels ?? 0} audio channel(s) instead of stereo`);
  if (info.sampleRate !== 48_000 && info.sampleRate !== 44_100) problems.push(`audio at ${info.sampleRate ?? "unknown"} Hz`);
  if ((info.audioBitrate ?? 0) < MIN_AUDIO_BITRATE) problems.push("audio under 128 kbps");
  return problems;
}

function ratio(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [a, b] = value.split("/").map(Number);
  return b ? a / b : Number.isFinite(a) ? a : undefined;
}

// Reads the facts above with ffprobe (next to ffmpeg, else on PATH). Keyframes are only
// looked at in the first ten minutes, which is enough to see how the encoder was set.
export async function probeVideo(ffmpeg: string, file: string): Promise<VideoInfo> {
  const sibling = path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  const ffprobe = await fs.stat(sibling).then(() => sibling, () => "ffprobe");
  const { stdout } = await execFileAsync(
    ffprobe,
    ["-v", "error", "-read_intervals", "%+600", "-show_streams", "-show_entries", "packet=stream_index,pts_time,flags", "-of", "json", file],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  const data = JSON.parse(stdout) as {
    streams?: Record<string, string | number | undefined>[];
    packets?: { pts_time?: string; flags?: string; stream_index?: number }[];
  };
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  const keyTimes = (data.packets ?? [])
    .filter((packet) => packet.flags?.startsWith("K") && packet.stream_index === video?.index)
    .map((packet) => Number(packet.pts_time))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  let gap: number | undefined = keyTimes.length > 1 ? 0 : undefined;
  for (let index = 1; index < keyTimes.length; index++) gap = Math.max(gap ?? 0, keyTimes[index] - keyTimes[index - 1]);
  // Fewer than two keyframes in ten minutes of a file that long is itself the problem.
  if (gap === undefined && keyTimes.length === 1 && Number(video?.duration ?? 0) > 20) gap = Number(video?.duration);
  const parsedFps = ratio(String(video?.avg_frame_rate ?? video?.r_frame_rate));
  return {
    videoCodec: String(video?.codec_name ?? ""),
    profile: String(video?.profile ?? ""),
    pixFmt: String(video?.pix_fmt ?? ""),
    fps: parsedFps ? Math.round(parsedFps * 100) / 100 : undefined,
    maxKeyframeGap: gap,
    audioCodec: audio ? String(audio.codec_name ?? "") : undefined,
    channels: audio ? Number(audio.channels) : undefined,
    sampleRate: audio ? Number(audio.sample_rate) : undefined,
    audioBitrate: audio ? Number(audio.bit_rate) : undefined,
    durationSeconds: Number(video?.duration) || undefined,
  };
}

export function facebookArgs(input: { file: string; outPath: string; sourceFps?: number }): string[] {
  const source = input.sourceFps ?? 1;
  // Keep a frame rate already in the feed's range, otherwise 30 (a 1 fps slideshow needs
  // frames repeated, which costs almost nothing in size).
  const fps = source >= 24 && source <= 30 ? Math.round(source) : 30;
  const args = [
    "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats",
    "-i", input.file,
    "-map", "0:v:0", "-map", "0:a:0",
    "-vf", `fps=${fps},format=yuv420p`,
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
  ];
  const still = source <= 2;
  if (still) args.push("-tune", "stillimage");
  // A keyframe every 2 s (4 s for a still, where each keyframe is a whole picture and the
  // size is mostly keyframes), never placed by scene detection, so the GOP is regular and closed.
  const gop = fps * (still ? 4 : 2);
  args.push(
    "-preset", "veryfast", "-crf", still ? "23" : "18",
    "-g", String(gop), "-keyint_min", String(gop), "-sc_threshold", "0", "-bf", "2",
    "-x264-params", "open-gop=0",
    "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    input.outPath
  );
  return args;
}

export interface PreparedVideo {
  path: string;
  // True when a re-encoded copy was made (and must be removed with `cleanup`).
  converted: boolean;
  cleanup(): Promise<void>;
}

export interface PrepareInput {
  file: string;
  signal?: AbortSignal;
  // 0–1 while the copy is being made.
  onProgress?: (fraction: number) => void;
  // Test seams.
  ffmpeg?: string;
  probe?: (ffmpeg: string, file: string) => Promise<VideoInfo>;
  run?: (command: string, args: string[], options: RunOptions) => Promise<void>;
}

export async function prepareForFacebook(input: PrepareInput): Promise<PreparedVideo> {
  const ffmpeg = input.ffmpeg ?? findFfmpeg(loadYouTubeConfig().ffmpegPath);
  if (!ffmpeg) {
    throw new Error(t("ffmpeg was not found. Install it (for example: brew install ffmpeg) or set its path in Settings → YouTube."));
  }
  let info: VideoInfo = {};
  try {
    info = await (input.probe ?? probeVideo)(ffmpeg, input.file);
  } catch {
    // Without a reading the file is converted: unknown is treated as not meeting the guidance.
  }
  if (facebookProblems(info).length === 0) return { path: input.file, converted: false, cleanup: async () => {} };
  const outPath = path.join(path.dirname(input.file), `.facebook-${path.basename(input.file, ".mp4")}-${Date.now()}.mp4`);
  try {
    await (input.run ?? runFfmpeg)(ffmpeg, facebookArgs({ file: input.file, outPath, sourceFps: info.fps }), {
      signal: input.signal,
      durationSeconds: info.durationSeconds,
      onProgress: input.onProgress,
    });
  } catch (err) {
    await fs.rm(outPath, { force: true });
    throw err;
  }
  return { path: outPath, converted: true, cleanup: () => fs.rm(outPath, { force: true }) };
}
