import fs from "fs/promises";
import path from "path";
import { StoredStory } from "../../types";
import { Library } from "../../routes/library";
import { activeAgent, AgentModel } from "../agent/agentConfig";
import { backgroundMusic } from "../backgroundMusic";
import { estimateRemainingMs } from "../crawl";
import { t } from "../lang";
import { readAudioMeta, readChapterAudio } from "../tts/audioCache";
import { chapterParts } from "../tts/chapterText";
import { accessToken, loadAccount, YouTubeAccount } from "./account";
import {
  chapterNumber,
  createPlaylist,
  findPlaylist,
  insertPlaylistItem,
  isQuotaError,
  listPlaylistItems,
  listVideoDetails,
  playlistPosition,
  uploadVideo,
} from "./api";
import { YouTubeConfig } from "./config";
import { descriptionFor, playlistTitle, tagsFor, videoTitle } from "./meta";
import { summarizeChapter } from "./summarize";
import { YouTubeStoryRecord, YouTubeVideoRecord } from "./types";
import { findFfmpeg, renderVideo } from "./video";

/**
 * The three server-side YouTube jobs. Nothing here decides to publish by itself: prepare
 * only fills drafts, render only writes files, and upload runs only when the route was
 * called with the person's confirmation (the route enforces the playlist confirmation).
 */
export type YouTubePhase = "prepare" | "render" | "upload" | "compilation" | "facebook";

export type YouTubeEvent =
  | { type: "youtube-progress"; phase: YouTubePhase; order?: number; done: number; total: number; percent?: number }
  | {
      type: "youtube-chapter-done";
      phase: YouTubePhase;
      order: number;
      state: "done" | "error";
      message?: string;
      done: number;
      total: number;
      etaMs?: number;
    }
  | {
      type: "youtube-idle";
      phase: YouTubePhase;
      done: number;
      failed: number;
      total: number;
      cancelled: boolean;
      message?: string;
    };

export class PlaylistMissingError extends Error {
  playlistName: string;

  constructor(playlistName: string) {
    super(t("The playlist \"{name}\" does not exist yet", { name: playlistName }));
    this.name = "PlaylistMissingError";
    this.playlistName = playlistName;
  }
}

export function youtubeVideoDir(dataDir: string, storyId: string): string {
  return path.join(dataDir, "youtube", storyId);
}

export function youtubeVideoPath(dataDir: string, storyId: string, order: number): string {
  return path.join(youtubeVideoDir(dataDir, storyId), `${order}.mp4`);
}

function relativeVideoPath(storyId: string, order: number): string {
  return ["youtube", storyId, `${order}.mp4`].join("/");
}

// Only a file inside this story's own video folder may be read or served.
export function resolveVideoPath(dataDir: string, storyId: string, record: YouTubeVideoRecord): string | undefined {
  if (!record.videoPath) return undefined;
  const root = path.resolve(youtubeVideoDir(dataDir, storyId));
  const resolved = path.resolve(dataDir, record.videoPath);
  return resolved.startsWith(root + path.sep) ? resolved : undefined;
}

function playlistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}

async function saveVideo(
  library: Library,
  storyId: string,
  record: YouTubeVideoRecord,
  patch: Partial<YouTubeVideoRecord>
): Promise<YouTubeVideoRecord> {
  const next: YouTubeVideoRecord = { ...record, ...patch, updatedAt: new Date().toISOString() };
  await library.stories.saveYouTubeVideo({ ...next, storyId });
  return next;
}

async function failChapter(
  library: Library,
  storyId: string,
  order: number,
  record: YouTubeVideoRecord | undefined,
  message: string,
  done: number,
  total: number,
  phase: YouTubePhase,
  onEvent: (event: YouTubeEvent) => void,
  startedAt: number
): Promise<void> {
  if (record) await saveVideo(library, storyId, record, { status: "error", error: message });
  else {
    await library.stories.saveYouTubeVideo({
      storyId,
      order,
      status: "error",
      error: message,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  onEvent({
    type: "youtube-chapter-done",
    phase,
    order,
    state: "error",
    message,
    done,
    total,
    etaMs: estimateRemainingMs({ startedAt, completed: done, total }),
  });
}

export interface PrepareInput {
  library: Library;
  story: StoredStory;
  orders: number[];
  agent?: AgentModel;
  config: YouTubeConfig;
  // Omitted = keep what the story already has (or the settings default).
  music?: { id?: string; volume?: number };
  publishAt?: Record<number, string>;
  author?: string;
  translator?: string;
  genreTags?: string;
  signal: AbortSignal;
  onEvent: (event: YouTubeEvent) => void;
}

// Drafts the upload info for the chosen chapters: a summary from the agent, then the
// title/description/tags/playlist the skill's template prescribes.
export async function prepareYouTubeChapters(input: PrepareInput): Promise<{ done: number; failed: number }> {
  const { library, story, signal, onEvent } = input;
  const total = input.orders.length;
  const startedAt = Date.now();
  let done = 0;
  let failed = 0;

  const existing = await library.stories.getYouTubeStory(story.id);
  const record: YouTubeStoryRecord = {
    storyId: story.id,
    playlistTitle: playlistTitle(story.title, input.config.channel),
    playlistId: existing?.playlistId,
    playlistUrl: existing?.playlistUrl,
    playlistCheckedAt: existing?.playlistCheckedAt,
    author: input.author ?? existing?.author ?? story.author,
    translator: input.translator ?? existing?.translator,
    genreTags: input.genreTags ?? existing?.genreTags ?? input.config.genreTags,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // Look the playlist up once so the panel can say whether upload would create it.
  try {
    const account = await loadAccount();
    if (account) {
      const token = await accessToken(account);
      const found = await findPlaylist(token, record.playlistTitle);
      record.playlistId = found?.id;
      record.playlistUrl = found ? playlistUrl(found.id) : undefined;
      record.playlistCheckedAt = new Date().toISOString();
    }
  } catch {
    // Offline or signed out: keep the last known playlist state.
  }
  await library.stories.saveYouTubeStory(record);

  for (const order of input.orders) {
    if (signal.aborted) break;
    const previous = await library.stories.getYouTubeVideo(story.id, order);
    if (previous?.status === "uploaded") {
      done++;
      onEvent({
        type: "youtube-chapter-done",
        phase: "prepare",
        order,
        state: "done",
        done,
        total,
        etaMs: estimateRemainingMs({ startedAt, completed: done, total }),
      });
      continue;
    }
    const chapter = await library.stories.getChapter(story.id, order);
    const audio = await readChapterAudio(library.dataDir, story.id, order);
    if (!chapter || chapter.status !== "done" || !audio) {
      const message = t("Chapter {order} has no audio yet — narrate it first", { order });
      await failChapter(library, story.id, order, previous, message, done, total, "prepare", onEvent, startedAt);
      failed++;
      continue;
    }

    let summary = previous?.summary;
    if (input.agent) {
      try {
        const text = chapterParts(chapter.title, chapter.blocks ?? []).join(" ");
        summary = await summarizeChapter(input.agent, {
          storyTitle: story.title,
          order,
          text,
          signal,
        });
      } catch (err) {
        if (signal.aborted) break;
        const message = err instanceof Error ? err.message : String(err);
        await failChapter(library, story.id, order, previous, message, done, total, "prepare", onEvent, startedAt);
        failed++;
        continue;
      }
    }

    const music = input.music ?? {
      id: previous?.musicId ?? input.config.musicId,
      volume: previous?.musicVolume ?? input.config.musicVolume,
    };
    const common = {
      storyTitle: story.title,
      order,
      channel: input.config.channel,
      author: record.author,
      translator: record.translator,
      genreTags: record.genreTags,
      scheduleTime: input.config.scheduleTime,
    };
    const next: YouTubeVideoRecord = {
      order,
      status: previous?.status === "rendered" ? "rendered" : "draft",
      title: videoTitle(story.title, order, input.config.channel),
      description: descriptionFor({ ...common, summary }),
      tags: tagsFor(common).join(", "),
      publishAt: input.publishAt?.[order] ?? previous?.publishAt,
      summary,
      musicId: music.id || undefined,
      musicVolume: music.volume ?? input.config.musicVolume,
      videoPath: previous?.videoPath,
      videoSeconds: previous?.videoSeconds,
      videoId: previous?.videoId,
      videoUrl: previous?.videoUrl,
      privacy: previous?.privacy,
      audioKey: previous?.audioKey,
      error: undefined,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await library.stories.saveYouTubeVideo({ ...next, storyId: story.id });
    done++;
    onEvent({
      type: "youtube-chapter-done",
      phase: "prepare",
      order,
      state: "done",
      done,
      total,
      etaMs: estimateRemainingMs({ startedAt, completed: done, total }),
    });
  }
  return { done, failed };
}

export interface RenderInput {
  library: Library;
  story: StoredStory;
  orders: number[];
  config: YouTubeConfig;
  // The music chosen in the panel for this run, applied to every chapter (and stored on
  // it) — so picking a track and pressing "Make videos" is enough, no re-prepare needed.
  music?: { id?: string; volume?: number };
  signal: AbortSignal;
  onEvent: (event: YouTubeEvent) => void;
}

export async function renderYouTubeVideos(input: RenderInput): Promise<{ done: number; failed: number }> {
  const { library, story, signal, onEvent } = input;
  const command = findFfmpeg(input.config.ffmpegPath);
  if (!command) {
    throw new Error(t("ffmpeg was not found. Install it (for example: brew install ffmpeg) or set its path in Settings → YouTube."));
  }
  const cover = library.covers.find(story.id);
  if (!cover) throw new Error(t("This story has no cover image yet — add one before making videos"));

  const total = input.orders.length;
  const startedAt = Date.now();
  let done = 0;
  let failed = 0;
  for (const order of input.orders) {
    if (signal.aborted) break;
    const record = await library.stories.getYouTubeVideo(story.id, order);
    if (!record || record.status === "uploaded") {
      done++;
      onEvent({ type: "youtube-chapter-done", phase: "render", order, state: "done", done, total });
      continue;
    }
    const audio = await readChapterAudio(library.dataDir, story.id, order);
    const meta = await readAudioMeta(library.dataDir, story.id, order);
    if (!audio || !meta) {
      const message = t("Chapter {order} has no audio yet — narrate it first", { order });
      await failChapter(library, story.id, order, record, message, done, total, "render", onEvent, startedAt);
      failed++;
      continue;
    }
    const musicId = input.music ? input.music.id : record.musicId;
    const musicVolume = input.music ? input.music.volume ?? input.config.musicVolume : record.musicVolume;
    const track = musicId ? await backgroundMusic.get(musicId) : undefined;
    if (musicId && !track) {
      const message = t("Background music track not found");
      await failChapter(library, story.id, order, record, message, done, total, "render", onEvent, startedAt);
      failed++;
      continue;
    }
    const rendering = await saveVideo(library, story.id, record, {
      status: "rendering",
      error: undefined,
      musicId,
      musicVolume,
    });
    try {
      await renderVideo({
        command,
        coverPath: cover.filePath,
        audioPath: audio.filePath,
        outPath: youtubeVideoPath(library.dataDir, story.id, order),
        seconds: meta.seconds,
        musicPath: track ? backgroundMusic.filePath(track) : undefined,
        musicVolume,
        signal,
        onProgress: (fraction) =>
          onEvent({ type: "youtube-progress", phase: "render", order, done, total, percent: Math.round(fraction * 100) }),
      });
      await saveVideo(library, story.id, rendering, {
        status: "rendered",
        videoPath: relativeVideoPath(story.id, order),
        videoSeconds: meta.seconds,
        audioKey: meta.text,
        error: undefined,
      });
      done++;
      onEvent({
        type: "youtube-chapter-done",
        phase: "render",
        order,
        state: "done",
        done,
        total,
        etaMs: estimateRemainingMs({ startedAt, completed: done, total }),
      });
    } catch (err) {
      if (signal.aborted) {
        await saveVideo(library, story.id, rendering, { status: "draft", error: undefined });
        break;
      }
      const message = err instanceof Error ? err.message : String(err);
      await failChapter(library, story.id, order, rendering, message, done, total, "render", onEvent, startedAt);
      failed++;
    }
  }
  return { done, failed };
}

export interface UploadInput {
  library: Library;
  story: StoredStory;
  orders: number[];
  config: YouTubeConfig;
  account: YouTubeAccount;
  // True only after the person confirmed creating the playlist in the upload dialog.
  createPlaylist: boolean;
  signal: AbortSignal;
  onEvent: (event: YouTubeEvent) => void;
}

export async function uploadYouTubeVideos(
  input: UploadInput
): Promise<{ done: number; failed: number; message?: string }> {
  const { library, story, signal, onEvent } = input;
  const token = await accessToken(input.account);
  const storyRecord = await library.stories.getYouTubeStory(story.id);
  const title = storyRecord?.playlistTitle ?? playlistTitle(story.title, input.config.channel);
  let playlist = await findPlaylist(token, title);
  if (!playlist) {
    if (!input.createPlaylist) throw new PlaylistMissingError(title);
    playlist = await createPlaylist(token, { title });
  }
  const now = new Date().toISOString();
  await library.stories.saveYouTubeStory({
    storyId: story.id,
    playlistTitle: title,
    playlistId: playlist.id,
    playlistUrl: playlistUrl(playlist.id),
    playlistCheckedAt: now,
    author: storyRecord?.author ?? story.author,
    translator: storyRecord?.translator,
    genreTags: storyRecord?.genreTags ?? input.config.genreTags,
    createdAt: storyRecord?.createdAt ?? now,
    updatedAt: now,
  });
  const items = await listPlaylistItems(token, playlist.id);

  const total = input.orders.length;
  const startedAt = Date.now();
  let done = 0;
  let failed = 0;
  for (const order of input.orders) {
    if (signal.aborted) break;
    const record = await library.stories.getYouTubeVideo(story.id, order);
    const file = record ? resolveVideoPath(library.dataDir, story.id, record) : undefined;
    const uploadable = record && (record.status === "rendered" || record.status === "uploading" || record.status === "error");
    if (!uploadable || (!record.videoId && !file)) {
      const message = t("Chapter {order} has no video yet — make the videos first", { order });
      await failChapter(library, story.id, order, record, message, done, total, "upload", onEvent, startedAt);
      failed++;
      continue;
    }
    if (!record.videoId && !(await fs.stat(file!).catch(() => undefined))) {
      const message = t("The video file for chapter {order} is missing — make the videos again", { order });
      await failChapter(library, story.id, order, record, message, done, total, "upload", onEvent, startedAt);
      failed++;
      continue;
    }

    let current = record;
    try {
      let videoId = record.videoId;
      if (!videoId) {
        current = await saveVideo(library, story.id, current, { status: "uploading", error: undefined });
        const uploaded = await uploadVideo(
          token,
          {
            filePath: file!,
            title: current.title ?? videoTitle(story.title, order, input.config.channel),
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
              phase: "upload",
              order,
              done,
              total,
              percent: size > 0 ? Math.round((sent / size) * 100) : 0,
            }),
          signal
        );
        videoId = uploaded.id;
        current = await saveVideo(library, story.id, current, {
          videoId,
          videoUrl: `https://youtu.be/${videoId}`,
          privacy: uploaded.privacyStatus ?? "private",
        });
      }
      // A chapter uploaded but not yet in the playlist only needs the second half.
      if (!items.some((item) => item.videoId === videoId)) {
        const position = playlistPosition(items, order);
        await insertPlaylistItem(token, { playlistId: playlist.id, videoId, position });
        items.push({ videoId, title: current.title ?? "" });
      }
      await saveVideo(library, story.id, current, { status: "uploaded", error: undefined });
      done++;
      onEvent({
        type: "youtube-chapter-done",
        phase: "upload",
        order,
        state: "done",
        done,
        total,
        etaMs: estimateRemainingMs({ startedAt, completed: done, total }),
      });
    } catch (err) {
      if (signal.aborted) break;
      const message = err instanceof Error ? err.message : String(err);
      await failChapter(library, story.id, order, current, message, done, total, "upload", onEvent, startedAt);
      if (isQuotaError(err)) {
        // The API's daily limit: stop the run, the user resumes when it resets.
        return {
          done,
          failed: failed + 1,
          message: t("YouTube's daily limit is reached. Try again after midnight Pacific time (about 14:00–15:00 Vietnam time)."),
        };
      }
      failed++;
    }
  }
  return { done, failed };
}

export interface SyncInput {
  library: Library;
  story: StoredStory;
  config: YouTubeConfig;
  account: YouTubeAccount;
}

/**
 * Marks the chapters that are already on the channel as uploaded — videos made by the
 * upload script (or another machine) are not in this library's tables, and re-uploading
 * them would duplicate them. Matches by chapter number inside the story's own playlist
 * and leaves records that already point at a video alone.
 */
export async function syncYouTubeUploads(
  input: SyncInput
): Promise<{ imported: number; updated: number; playlistTitle: string; playlistExists: boolean }> {
  const token = await accessToken(input.account);
  const storyRecord = await input.library.stories.getYouTubeStory(input.story.id);
  const title = storyRecord?.playlistTitle ?? playlistTitle(input.story.title, input.config.channel);
  const playlist = await findPlaylist(token, title);
  if (!playlist) return { imported: 0, updated: 0, playlistTitle: title, playlistExists: false };

  const now = new Date().toISOString();
  await input.library.stories.saveYouTubeStory({
    storyId: input.story.id,
    playlistTitle: title,
    playlistId: playlist.id,
    playlistUrl: playlistUrl(playlist.id),
    playlistCheckedAt: now,
    author: storyRecord?.author ?? input.story.author,
    translator: storyRecord?.translator,
    genreTags: storyRecord?.genreTags ?? input.config.genreTags,
    createdAt: storyRecord?.createdAt ?? now,
    updatedAt: now,
  });

  const items = await listPlaylistItems(token, playlist.id);
  const known = new Map(
    (await input.library.stories.listYouTubeVideos(input.story.id)).map((video) => [video.order, video])
  );
  const chapters = new Set(input.story.chapters.filter((chapter) => chapter.status === "done").map((chapter) => chapter.order));
  const matches = new Map<number, { videoId: string; title: string }>();
  for (const item of items) {
    if (!item.videoId) continue;
    const order = chapterNumber(item.title);
    if (order === undefined || !chapters.has(order) || matches.has(order)) continue;
    const record = known.get(order);
    // A record pointing at another video is this app's own upload: never overwrite it.
    if (record?.videoId && record.videoId !== item.videoId) continue;
    matches.set(order, { videoId: item.videoId, title: item.title });
  }
  if (matches.size === 0) return { imported: 0, updated: 0, playlistTitle: title, playlistExists: true };

  const details = await listVideoDetails(token, [...matches.values()].map((item) => item.videoId));
  let imported = 0;
  let updated = 0;
  for (const [order, item] of matches) {
    const previous = known.get(order);
    const detail = details.get(item.videoId);
    const isNew = !previous?.videoId;
    // What the channel knows fills what this library never had; a field the person edited
    // here is never replaced by the channel's copy.
    const description = previous?.description ?? detail?.description ?? undefined;
    const tags = previous?.tags ?? (detail?.tags?.length ? detail.tags.join(", ") : undefined);
    const filled = (!previous?.description && Boolean(detail?.description)) || (!previous?.tags && Boolean(detail?.tags?.length));
    if (!isNew && !filled) continue;
    await input.library.stories.saveYouTubeVideo({
      ...previous,
      storyId: input.story.id,
      order,
      status: "uploaded",
      title: detail?.title || item.title,
      description,
      tags,
      videoId: item.videoId,
      videoUrl: `https://youtu.be/${item.videoId}`,
      privacy: detail?.privacyStatus ?? previous?.privacy,
      publishAt: detail?.publishAt ?? previous?.publishAt,
      error: undefined,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });
    if (isNew) imported++;
    else updated++;
  }
  return { imported, updated, playlistTitle: title, playlistExists: true };
}

export interface YouTubeStateChapter {
  order: number;
  title: string;
  hasAudio: boolean;
  // Audio length in seconds, for the compilation plan shown in the panel.
  seconds?: number;
  // The video was made from audio that has since been regenerated.
  audioChanged: boolean;
  record?: YouTubeVideoRecord;
}

export interface YouTubeState {
  connected: boolean;
  channel?: string;
  // The agent setting is on and its CLI is installed: the panel offers the AI actions.
  agentReady: boolean;
  cover: boolean;
  ffmpeg: boolean;
  config: {
    channel: string;
    scheduleTime: string;
    genreTags: string;
    musicId?: string;
    musicVolume: number;
  };
  story: { title: string; author?: string; language?: string };
  playlist: { title: string; id?: string; url?: string; checkedAt?: string; exists: boolean };
  credits: { author?: string; translator?: string; genreTags: string };
  chapters: YouTubeStateChapter[];
}

// Everything the panel needs to render, from the store and the disk; the job events keep
// it current while a run is on.
export async function youTubeState(library: Library, story: StoredStory, config: YouTubeConfig): Promise<YouTubeState> {
  const storyRecord = await library.stories.getYouTubeStory(story.id);
  const videos = await library.stories.listYouTubeVideos(story.id);
  const byOrder = new Map(videos.map((video) => [video.order, video]));
  const chapters: YouTubeStateChapter[] = [];
  for (const chapter of story.chapters) {
    if (chapter.status !== "done") continue;
    const audio = await readChapterAudio(library.dataDir, story.id, chapter.order);
    const meta = audio ? await readAudioMeta(library.dataDir, story.id, chapter.order) : undefined;
    const record = byOrder.get(chapter.order);
    chapters.push({
      order: chapter.order,
      title: chapter.title,
      hasAudio: Boolean(audio),
      seconds: audio?.seconds,
      audioChanged: Boolean(record?.audioKey && meta?.text && record.audioKey !== meta.text),
      record,
    });
  }
  const account = await loadAccount();
  return {
    connected: Boolean(account?.refreshToken || account?.accessToken),
    channel: account?.channelTitle,
    agentReady: Boolean(activeAgent()),
    cover: Boolean(library.covers.find(story.id)),
    ffmpeg: Boolean(findFfmpeg(config.ffmpegPath)),
    config: {
      channel: config.channel,
      scheduleTime: config.scheduleTime,
      genreTags: config.genreTags,
      musicId: config.musicId,
      musicVolume: config.musicVolume,
    },
    story: { title: story.title, author: story.author, language: story.language },
    playlist: storyRecord
      ? {
          title: storyRecord.playlistTitle,
          id: storyRecord.playlistId,
          url: storyRecord.playlistUrl,
          checkedAt: storyRecord.playlistCheckedAt,
          exists: Boolean(storyRecord.playlistId),
        }
      : { title: playlistTitle(story.title, config.channel), exists: false },
    credits: {
      author: storyRecord?.author ?? story.author,
      translator: storyRecord?.translator,
      genreTags: storyRecord?.genreTags ?? config.genreTags,
    },
    chapters,
  };
}
