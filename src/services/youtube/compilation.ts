import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { StoredStory } from "../../types";
import { Library } from "../../routes/library";
import { backgroundMusic } from "../backgroundMusic";
import { estimateRemainingMs } from "../crawl";
import { t } from "../lang";
import { readChapterAudio } from "../tts/audioCache";
import { accessToken, YouTubeAccount } from "./account";
import {
  createPlaylist,
  findPlaylist,
  insertPlaylistItem,
  isQuotaError,
  listPlaylistItems,
  playlistPosition,
  uploadVideo,
} from "./api";
import { YouTubeConfig } from "./config";
import { hashtagFromTitle, sanitizeYouTubeText } from "./meta";
import { CompilationPlatform, YouTubeCompilationRecord } from "./types";
import { findFfmpeg, renderVideo, runFfmpeg } from "./video";
import { YouTubeEvent } from "./jobs";
import { renderIllustratedCompilation } from "../illustrated/compilation";
import { AgentModel } from "../agent/agentConfig";
import { Bible } from "../illustrated/types";
import { readAudioMeta } from "../tts/audioCache";

/**
 * The story's compilation: several narrated chapters joined into one long video, split so
 * no part passes YouTube's 12-hour limit — the workspace's `truyen-fm-compilation` skill.
 * Audio is concatenated to a temporary MP3 (128 kbps) first, then the usual still-cover
 * render makes the video; the description carries a timestamped table of contents.
 */
export const MAX_PART_SECONDS = 11 * 3600;
// Facebook takes a Page video up to 4 hours; the margin keeps a part clear of the limit
// after the audio is joined and re-encoded.
export const FACEBOOK_PART_SECONDS = 4 * 3600 - 300;

export function maxPartSeconds(platform: CompilationPlatform): number {
  return platform === "facebook" ? FACEBOOK_PART_SECONDS : MAX_PART_SECONDS;
}

// Greedy split in chapter order: a part takes the next chapter while it still fits.
export function planCompilationParts(
  orders: number[],
  seconds: Map<number, number>,
  maxSeconds: number = MAX_PART_SECONDS
): number[][] {
  const parts: number[][] = [];
  let current: number[] = [];
  let total = 0;
  for (const order of orders) {
    const length = seconds.get(order) ?? 0;
    if (current.length > 0 && total + length > maxSeconds) {
      parts.push(current);
      current = [];
      total = 0;
    }
    current.push(order);
    total += length;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

export function timestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

// The lines the skill puts under "⏱️ Mục lục:", each part starting at 0:00 so YouTube
// reads them as chapters.
export function tocFor(orders: number[], seconds: Map<number, number>): string[] {
  let at = 0;
  const lines: string[] = [];
  for (const order of orders) {
    lines.push(`${timestamp(at)} Chương ${order}`);
    at += seconds.get(order) ?? 0;
  }
  return lines;
}

export function compilationLabel(labelWord: string, part: number, parts: number, from: number, to: number): string {
  const range = `Chương ${from}-${to}`;
  return parts > 1 ? `${labelWord} Phần ${part} (${range})` : `${labelWord} (${range})`;
}

export interface CompilationMetaInput {
  storyTitle: string;
  channel: string;
  label: string;
  labelWord: string;
  intro?: string;
  toc: string[];
  author?: string;
  translator?: string;
  genreTags?: string;
}

export function compilationPlaylistTitle(storyTitle: string, channel: string): string {
  return sanitizeYouTubeText(`${storyTitle} – Trọn bộ | ${channel}`);
}

export function compilationMeta(input: CompilationMetaInput): {
  title: string;
  description: string;
  tags: string;
  playlistTitle: string;
} {
  const titleLabel = input.label.replaceAll("-", "–");
  const title = sanitizeYouTubeText(`${input.storyTitle} – ${titleLabel} | ${input.channel}`).slice(0, 100);
  const lines: string[] = [`🎧 Nghe truyện audio "${input.storyTitle}" – ${titleLabel}.`, ""];
  if (input.intro?.trim()) lines.push(`📖 ${input.intro.trim()}`, "");
  if (input.toc.length > 0) lines.push("⏱️ Mục lục:", ...input.toc, "");
  const author = input.author?.trim();
  const translator = input.translator?.trim();
  if (author) lines.push(`✍️ Tác giả: ${author}`);
  if (translator) lines.push(`🌐 Dịch: ${translator}`);
  lines.push(
    `🔔 Đăng ký kênh ${input.channel} và bấm chuông để không bỏ lỡ những câu chuyện tiếp theo.`,
    "",
    "⚠️ Nội dung chỉ nhằm mục đích giải trí.",
    "",
    [
      hashtagFromTitle(input.channel) && `#${hashtagFromTitle(input.channel)}`,
      `#${hashtagFromTitle(input.storyTitle)}`,
      "#TruyệnAudio",
      "#NgheTruyện",
    ]
      .filter(Boolean)
      .join(" ")
  );
  const tags = [
    input.storyTitle,
    "truyện audio",
    "nghe truyện",
    input.channel,
    `${input.storyTitle} ${input.labelWord.toLowerCase()}`,
  ];
  if (input.genreTags?.trim()) tags.push(...input.genreTags.split(",").map((tag) => tag.trim()).filter(Boolean));
  tags.push("nghe truyện đêm khuya", "nghe truyện ngủ");
  const kept: string[] = [];
  let length = 0;
  for (const tag of new Set(tags.map((tag) => sanitizeYouTubeText(tag.trim())))) {
    if (!tag || tag.length > 100) continue;
    if (length + tag.length + 1 > 500) break;
    kept.push(tag);
    length += tag.length + 1;
  }
  return {
    title,
    description: sanitizeYouTubeText(lines.join("\n")),
    tags: kept.join(", "),
    playlistTitle: compilationPlaylistTitle(input.storyTitle, input.channel),
  };
}

// The 📖 line of a rendered description, updated in place: the contents, credits and
// hashtags stay exactly as the render wrote them.
export function withIntro(description: string, intro: string): string {
  const block = `📖 ${intro.trim()}`;
  if (!description.trim()) return block;
  const lines = description.split("\n");
  const index = lines.findIndex((line) => line.startsWith("📖 "));
  if (index >= 0) {
    lines[index] = block;
    return lines.join("\n");
  }
  // Right under the opening "🎧 …" line and its blank line.
  lines.splice(1, 0, "", block);
  return lines.join("\n");
}

// Facebook parts are cut differently from YouTube's, so they get their own files.
export function compilationVideoPath(storyId: string, from: number, to: number, platform: CompilationPlatform = "youtube"): string {
  return ["youtube", storyId, `${platform === "facebook" ? "facebook-" : ""}compilation-${from}-${to}.mp4`].join("/");
}

export function resolveCompilationPath(dataDir: string, storyId: string, record: YouTubeCompilationRecord): string | undefined {
  if (!record.videoPath) return undefined;
  const root = path.resolve(dataDir, "youtube", storyId);
  const resolved = path.resolve(dataDir, record.videoPath);
  return resolved.startsWith(root + path.sep) ? resolved : undefined;
}

export interface CompilationPlanPart {
  part: number;
  from: number;
  to: number;
  hours: number;
  orders: number[];
}

export interface CompilationPlan {
  totalHours: number;
  parts: CompilationPlanPart[];
  // Chapters without narration audio: a compilation cannot include them.
  missing: number[];
}

export async function planCompilation(
  library: Library,
  storyId: string,
  orders: number[],
  platform: CompilationPlatform = "youtube"
): Promise<CompilationPlan> {
  const seconds = new Map<number, number>();
  const missing: number[] = [];
  for (const order of orders) {
    const audio = await readChapterAudio(library.dataDir, storyId, order);
    if (!audio) missing.push(order);
    else seconds.set(order, audio.seconds);
  }
  const parts = planCompilationParts(orders, seconds, maxPartSeconds(platform)).map((group, index) => ({
    part: index + 1,
    from: group[0],
    to: group[group.length - 1],
    hours: group.reduce((sum, order) => sum + (seconds.get(order) ?? 0), 0) / 3600,
    orders: group,
  }));
  return {
    totalHours: orders.reduce((sum, order) => sum + (seconds.get(order) ?? 0), 0) / 3600,
    parts,
    missing,
  };
}

// The concat demuxer needs a list file; paths are quoted for names with spaces/quotes.
async function concatAudio(
  command: string,
  files: string[],
  out: string,
  options: { signal?: AbortSignal; durationSeconds?: number; onProgress?: (fraction: number) => void }
): Promise<void> {
  const listFile = `${out}.list.txt`;
  const contents = files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listFile, `${contents}\n`);
  try {
    await runFfmpeg(
      command,
      ["-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-f", "concat", "-safe", "0", "-i", listFile, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", out],
      { signal: options.signal, durationSeconds: options.durationSeconds, onProgress: options.onProgress }
    );
  } finally {
    await fs.rm(listFile, { force: true });
  }
}

export interface CompilationRenderInput {
  library: Library;
  story: StoredStory;
  config: YouTubeConfig;
  orders: number[];
  intro?: string;
  labelWord?: string;
  music?: { id?: string; volume?: number };
  // Which platform the parts are cut for (YouTube up to 11 h, Facebook up to 4 h).
  platform?: CompilationPlatform;
  // Draw the parts as illustrated slides (one or two scenes per chapter) instead of the
  // still cover; `agent` plans the scenes of a chapter that has no saved storyboard.
  illustrated?: { bible: Bible; agent?: AgentModel };
  // By part number (1-based), like the upload schedule of the single chapters.
  publishAt?: Record<number, string>;
  signal: AbortSignal;
  onEvent: (event: YouTubeEvent) => void;
}

export async function renderCompilations(input: CompilationRenderInput): Promise<{ done: number; failed: number }> {
  const { library, story, signal, onEvent } = input;
  const command = findFfmpeg(input.config.ffmpegPath);
  if (!command) {
    throw new Error(t("ffmpeg was not found. Install it (for example: brew install ffmpeg) or set its path in Settings → YouTube."));
  }
  const platform = input.platform ?? "youtube";
  const cover = library.covers.find(story.id);
  if (!cover && !input.illustrated) throw new Error(t("This story has no cover image yet — add one before making videos"));

  const plan = await planCompilation(library, story.id, input.orders, platform);
  if (plan.missing.length > 0) {
    throw new Error(
      t("Chapter {order} has no audio yet — narrate it first", { order: plan.missing[0] })
    );
  }
  const storyRecord = await library.stories.getYouTubeStory(story.id);
  const labelWord = input.labelWord?.trim() || "Trọn bộ";
  const existing = await library.stories.listCompilations(story.id, platform);
  const total = plan.parts.length;
  const startedAt = Date.now();
  let done = 0;
  let failed = 0;

  for (const part of plan.parts) {
    if (signal.aborted) break;
    const previous = existing.find(
      (record) => record.fromOrder === part.from && record.toOrder === part.to && record.part === part.part
    );
    const id = previous?.id ?? crypto.randomUUID();
    const label = compilationLabel(labelWord, part.part, total, part.from, part.to);
    const seconds = new Map<number, number>();
    const files: string[] = [];
    for (const order of part.orders) {
      const audio = await readChapterAudio(library.dataDir, story.id, order);
      if (!audio) throw new Error(t("Chapter {order} has no audio yet — narrate it first", { order }));
      seconds.set(order, audio.seconds);
      files.push(audio.filePath);
    }
    const partSeconds = [...seconds.values()].reduce((sum, value) => sum + value, 0);
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-compilation-"));
    const audioPath = path.join(workDir, "all.mp3");
    const outPath = path.join(library.dataDir, compilationVideoPath(story.id, part.from, part.to, platform));
    const track = input.music?.id ? await backgroundMusic.get(input.music.id) : undefined;
    if (input.music?.id && !track) {
      const message = t("Background music track not found");
      await library.stories.saveCompilation({
        ...previous,
        id,
        storyId: story.id,
        part: part.part,
        parts: total,
        label,
        fromOrder: part.from,
        toOrder: part.to,
        platform,
        status: "error",
        error: message,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      failed++;
      onEvent({ type: "youtube-chapter-done", phase: "compilation", order: part.part, state: "error", message, done, total });
      continue;
    }
    try {
      await library.stories.saveCompilation({
        ...previous,
        id,
        storyId: story.id,
        part: part.part,
        parts: total,
        label,
        fromOrder: part.from,
        toOrder: part.to,
        platform,
        status: "rendering",
        error: undefined,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      // Joining + re-encoding the audio, then encoding the video: the two stages make one
      // 0–100% per part, split at the halfway point so the bar never jumps backwards.
      await concatAudio(command, files, audioPath, {
        signal,
        durationSeconds: partSeconds,
        onProgress: (fraction) =>
          onEvent({
            type: "youtube-progress",
            phase: "compilation",
            order: part.part,
            done,
            total,
            percent: Math.round(fraction * 50),
          }),
      });
      const onVideoProgress = (fraction: number) =>
        onEvent({
          type: "youtube-progress",
          phase: "compilation",
          order: part.part,
          done,
          total,
          percent: 50 + Math.round(fraction * 50),
        });
      if (input.illustrated) {
        const chapters = [];
        for (const order of part.orders) {
          const chapter = await library.stories.getChapter(story.id, order);
          const audioMeta = await readAudioMeta(library.dataDir, story.id, order);
          if (!chapter || !audioMeta) throw new Error(t("Chapter {order} has no audio yet — narrate it first", { order }));
          chapters.push({ order, title: chapter.title, blocks: chapter.blocks ?? [], seconds: audioMeta.seconds, timings: audioMeta.timings });
        }
        await renderIllustratedCompilation({
          dataDir: library.dataDir,
          storyId: story.id,
          storyTitle: story.title,
          bible: input.illustrated.bible,
          chapters,
          agent: input.illustrated.agent,
          command,
          audioPath,
          seconds: partSeconds,
          outPath,
          musicPath: track ? backgroundMusic.filePath(track) : undefined,
          musicVolume: input.music?.volume,
          signal,
          onProgress: onVideoProgress,
        });
      } else {
        await renderVideo({
          command,
          coverPath: cover!.filePath,
          audioPath,
          outPath,
          seconds: partSeconds,
          musicPath: track ? backgroundMusic.filePath(track) : undefined,
          musicVolume: input.music?.volume,
          signal,
          onProgress: onVideoProgress,
        });
      }
      const meta = compilationMeta({
        storyTitle: story.title,
        channel: input.config.channel,
        label,
        labelWord,
        intro: input.intro,
        toc: tocFor(part.orders, seconds),
        author: storyRecord?.author ?? story.author,
        translator: storyRecord?.translator,
        genreTags: storyRecord?.genreTags ?? input.config.genreTags,
      });
      await library.stories.saveCompilation({
        ...previous,
        id,
        storyId: story.id,
        part: part.part,
        parts: total,
        label,
        fromOrder: part.from,
        toOrder: part.to,
        platform,
        status: "rendered",
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        publishAt: input.publishAt?.[part.part] ?? previous?.publishAt,
        videoPath: compilationVideoPath(story.id, part.from, part.to, platform),
        videoSeconds: partSeconds,
        videoId: previous?.videoId,
        videoUrl: previous?.videoUrl,
        privacy: previous?.privacy,
        error: undefined,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      done++;
      onEvent({
        type: "youtube-chapter-done",
        phase: "compilation",
        order: part.part,
        state: "done",
        done,
        total,
        etaMs: estimateRemainingMs({ startedAt, completed: done, total }),
      });
    } catch (err) {
      if (signal.aborted) break;
      const message = err instanceof Error ? err.message : String(err);
      const record = await library.stories.getCompilation(story.id, id);
      if (record) {
        await library.stories.saveCompilation({ ...record, storyId: story.id, status: "error", error: message });
      }
      failed++;
      onEvent({ type: "youtube-chapter-done", phase: "compilation", order: part.part, state: "error", message, done, total });
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }
  return { done, failed };
}

export interface CompilationUploadInput {
  library: Library;
  story: StoredStory;
  config: YouTubeConfig;
  account: YouTubeAccount;
  ids?: string[];
  // True only after the person confirmed creating the compilation playlist.
  createPlaylist: boolean;
  // False = upload with no playlist at all: nothing is created and nothing is added.
  withPlaylist?: boolean;
  signal: AbortSignal;
  onEvent: (event: YouTubeEvent) => void;
}

export async function uploadCompilations(
  input: CompilationUploadInput
): Promise<{ done: number; failed: number; message?: string }> {
  const { library, story, signal, onEvent } = input;
  const token = await accessToken(input.account);
  const title = compilationPlaylistTitle(story.title, input.config.channel);
  // No playlist asked for: the videos just go up (private, or scheduled as the records say).
  let playlist: Awaited<ReturnType<typeof findPlaylist>>;
  let items: Awaited<ReturnType<typeof listPlaylistItems>> = [];
  if (input.withPlaylist !== false) {
    playlist = await findPlaylist(token, title);
    if (!playlist) {
      if (!input.createPlaylist) throw new Error(t("The playlist \"{name}\" does not exist yet", { name: title }));
      playlist = await createPlaylist(token, { title });
    }
    items = await listPlaylistItems(token, playlist.id);
  }

  const all = (await library.stories.listCompilations(story.id, "youtube")).filter(
    (record) => !input.ids || input.ids.includes(record.id)
  );
  const plan = all.filter((record) => record.status === "rendered" || record.status === "error" || record.status === "uploading");
  const total = plan.length;
  const startedAt = Date.now();
  let done = 0;
  let failed = 0;
  for (const record of plan) {
    if (signal.aborted) break;
    const file = resolveCompilationPath(library.dataDir, story.id, record);
    if (!record.videoId && (!file || !(await fs.stat(file).catch(() => undefined)))) {
      const message = t("The video file for chapter {order} is missing — make the videos again", { order: record.fromOrder });
      await library.stories.saveCompilation({ ...record, storyId: story.id, status: "error", error: message });
      failed++;
      onEvent({ type: "youtube-chapter-done", phase: "compilation", order: record.part, state: "error", message, done, total });
      continue;
    }
    let current = record;
    try {
      let videoId = record.videoId;
      if (!videoId) {
        current = { ...current, status: "uploading", error: undefined };
        await library.stories.saveCompilation({ ...current, storyId: story.id });
        const uploaded = await uploadVideo(
          token,
          {
            filePath: file!,
            title: current.title ?? compilationLabel(title, current.part, current.parts, current.fromOrder, current.toOrder),
            description: current.description ?? "",
            tags: (current.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
            publishAt: current.publishAt,
            language: story.language ?? "vi",
            madeForKids: false,
            syntheticMedia: input.config.syntheticMedia,
          },
          (sent, size) =>
            onEvent({
              type: "youtube-progress",
              phase: "compilation",
              order: current.part,
              done,
              total,
              percent: size > 0 ? Math.round((sent / size) * 100) : 0,
            }),
          signal
        );
        videoId = uploaded.id;
        current = {
          ...current,
          videoId,
          videoUrl: `https://youtu.be/${videoId}`,
          privacy: uploaded.privacyStatus ?? "private",
        };
        await library.stories.saveCompilation({ ...current, storyId: story.id });
      }
      if (playlist && !items.some((item) => item.videoId === videoId)) {
        const position = playlistPosition(items, current.fromOrder);
        await insertPlaylistItem(token, { playlistId: playlist.id, videoId, position });
        items.push({ videoId, title: current.title ?? "" });
      }
      await library.stories.saveCompilation({ ...current, storyId: story.id, status: "uploaded", error: undefined });
      done++;
      onEvent({
        type: "youtube-chapter-done",
        phase: "compilation",
        order: current.part,
        state: "done",
        done,
        total,
        etaMs: estimateRemainingMs({ startedAt, completed: done, total }),
      });
    } catch (err) {
      if (signal.aborted) break;
      const message = err instanceof Error ? err.message : String(err);
      await library.stories.saveCompilation({ ...current, storyId: story.id, status: "error", error: message });
      if (isQuotaError(err)) {
        return {
          done,
          failed: failed + 1,
          message: t("YouTube's daily limit is reached. Try again after midnight Pacific time (about 14:00–15:00 Vietnam time)."),
        };
      }
      failed++;
      onEvent({ type: "youtube-chapter-done", phase: "compilation", order: current.part, state: "error", message, done, total });
    }
  }
  return { done, failed };
}

// The playlist name shown in the panel before anything exists.
export function compilationChannelPlaylist(storyTitle: string, channel: string): string {
  return compilationPlaylistTitle(storyTitle, channel);
}

// Kept for the panel's part list: the chapter title line a part starts with.
export function compilationRange(record: YouTubeCompilationRecord): string {
  return `Chương ${record.fromOrder}–${record.toOrder}`;
}

// Re-exported so the route can show a plan without importing the store twice.
export function compilationChapterLabel(order: number): string {
  return `Chương ${order}`;
}
