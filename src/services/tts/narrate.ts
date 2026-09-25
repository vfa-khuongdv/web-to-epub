import { VIENEU_VERSION } from "../../config/tts";
import { StoredChapter, StoredStory } from "../../types";
import { StoryStore } from "../storyStore";
import {
  NarrationVoice,
  chapterAudioPath,
  ensureStoryAudioDir,
  readFreshAudio,
  writeAudioMeta,
} from "./audioCache";
import { chapterParts, chapterPartsWithBlocks } from "./chapterText";
import { TtsRuntime } from "./runtime";
import { NarrationCancelled, TtsVariant } from "./workerClient";

// Narration is offered for Vietnamese books only (VieNeu reads nothing else). A story
// saved before the language field existed reads as Vietnamese, as it does in the UI.
export function isNarratable(story: Pick<StoredStory, "language">): boolean {
  return (story.language || "vi") === "vi";
}

export interface NarrationSettings {
  variant: TtsVariant;
  voice: string;
}

export type ChapterAudioState = "ready" | "missing";

function narrationVoice(settings: NarrationSettings): NarrationVoice {
  return { variant: settings.variant, voice: settings.voice };
}

// Only chapters with content can be read; pending/failed ones are left for the crawler.
function readable(chapter: Pick<StoredChapter, "status">): boolean {
  return chapter.status === "done";
}

// The current voice, so audio saved before text-only freshness is still recognised.
function legacy(settings: NarrationSettings) {
  return { voice: narrationVoice(settings), engineVersion: VIENEU_VERSION };
}

// The audio file of one chapter, if it matches the chapter's current text. The voice in
// Settings does not matter: audio made with another voice keeps playing.
export async function freshChapterAudio(
  stories: StoryStore,
  dataDir: string,
  storyId: string,
  order: number,
  settings: NarrationSettings
): Promise<{ filePath: string; seconds: number; timings?: [number, number][]; title: string; chapter: StoredChapter } | undefined> {
  const chapter = await stories.getChapter(storyId, order);
  if (!chapter || !readable(chapter)) return undefined;
  const parts = chapterParts(chapter.title, chapter.blocks ?? []);
  if (parts.length === 0) return undefined;
  const audio = await readFreshAudio(dataDir, storyId, order, parts, legacy(settings));
  return audio ? { ...audio, title: chapter.title, chapter } : undefined;
}

// Silence the worker puts after every part (tts/vieneu_worker.py PAUSE_SECONDS).
const PAUSE_SECONDS = 0.35;

export interface TimelinePart {
  // Block index in the chapter (element index in its HTML), -1 for the title.
  block: number;
  start: number;
  end: number;
}

/**
 * When each part of a chapter's audio plays, and which block it reads — what the reader
 * highlights while listening. Audio made before timings were recorded gets an estimate:
 * the speech time shared out by each part's length in characters.
 */
export async function chapterNarrationTimeline(
  stories: StoryStore,
  dataDir: string,
  storyId: string,
  order: number,
  settings: NarrationSettings
): Promise<TimelinePart[] | undefined> {
  const audio = await freshChapterAudio(stories, dataDir, storyId, order, settings);
  if (!audio) return undefined;
  const parts = chapterPartsWithBlocks(audio.chapter.title, audio.chapter.blocks ?? []);
  if (audio.timings && audio.timings.length === parts.length) {
    return parts.map((part, i) => ({ block: part.block, start: audio.timings![i][0], end: audio.timings![i][1] }));
  }
  return estimateTimeline(parts, audio.seconds);
}

export function estimateTimeline(parts: { text: string; block: number }[], seconds: number): TimelinePart[] {
  const speech = Math.max(0, seconds - PAUSE_SECONDS * parts.length);
  const chars = parts.reduce((sum, part) => sum + part.text.length, 0) || 1;
  let at = 0;
  return parts.map((part) => {
    const length = (speech * part.text.length) / chars;
    const entry = { block: part.block, start: round(at), end: round(at + length) };
    at += length + PAUSE_SECONDS;
    return entry;
  });
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * Which chapters already have audio matching their current text.
 * Reads each chapter's content one at a time rather than the whole story at once.
 */
export async function narrationStates(
  stories: StoryStore,
  dataDir: string,
  storyId: string,
  settings: NarrationSettings
): Promise<Record<number, ChapterAudioState>> {
  const outline = await stories.getOutline(storyId);
  const states: Record<number, ChapterAudioState> = {};
  if (!outline) return states;
  for (const summary of outline.chapters) {
    if (!readable(summary)) continue;
    const audio = await freshChapterAudio(stories, dataDir, storyId, summary.order, settings);
    states[summary.order] = audio ? "ready" : "missing";
  }
  return states;
}

export type NarrateEvent =
  | { type: "narrate-progress"; order: number; part: number; parts: number; done: number; total: number }
  | { type: "narrate-chapter-done"; order: number; seconds: number; skipped: boolean; done: number; total: number }
  | { type: "narrate-error"; order?: number; message: string; done: number; total: number };

export interface NarrateJob {
  stories: StoryStore;
  dataDir: string;
  storyId: string;
  // Chapters to read, in TOC order; all readable chapters when absent.
  orders?: number[];
  settings: () => NarrationSettings;
  runtime: Pick<TtsRuntime, "withModel">;
  signal: AbortSignal;
  onEvent: (event: NarrateEvent) => void;
}

// The plan: readable chapters (optionally the requested ones), in TOC order.
export async function chaptersToNarrate(stories: StoryStore, storyId: string, orders?: number[]): Promise<number[]> {
  const outline = await stories.getOutline(storyId);
  if (!outline) return [];
  const wanted = orders ? new Set(orders) : undefined;
  return outline.chapters
    .filter((chapter) => readable(chapter) && (!wanted || wanted.has(chapter.order)))
    .map((chapter) => chapter.order)
    .sort((a, b) => a - b);
}

/**
 * Narrate chapters one after another. A chapter whose audio is already fresh is skipped,
 * so running again after an app restart continues where it stopped. The voice is read
 * per chapter, so a change in Settings applies from the next chapter. A failed chapter
 * is reported and the job moves on — like a crawl, one bad chapter does not stop the rest.
 * Resolves with the number of chapters that have audio at the end; cancellation resolves
 * too (the caller learns of it from its own signal).
 */
export async function narrateChapters(job: NarrateJob, plan: number[]): Promise<{ done: number; failed: number }> {
  await ensureStoryAudioDir(job.dataDir, job.storyId);
  let done = 0;
  let failed = 0;
  const total = plan.length;

  for (const order of plan) {
    if (job.signal.aborted) break;
    const chapter = await job.stories.getChapter(job.storyId, order);
    const settings = job.settings();
    const parts = chapter ? chapterParts(chapter.title, chapter.blocks ?? []) : [];
    if (!chapter || parts.length === 0) {
      // Nothing to read (e.g. an images-only chapter): not an error, not audio either.
      job.onEvent({ type: "narrate-chapter-done", order, seconds: 0, skipped: true, done, total });
      continue;
    }

    const cached = await readFreshAudio(job.dataDir, job.storyId, order, parts, legacy(settings));
    if (cached) {
      done++;
      job.onEvent({ type: "narrate-chapter-done", order, seconds: cached.seconds, skipped: true, done, total });
      continue;
    }

    try {
      const { seconds, timings } = await job.runtime.withModel(settings.variant, (worker) =>
        worker.synth({
          parts,
          voice: settings.voice,
          out: chapterAudioPath(job.dataDir, job.storyId, order),
          signal: job.signal,
          onProgress: (part, count) =>
            job.onEvent({ type: "narrate-progress", order, part, parts: count, done, total }),
        })
      );
      await writeAudioMeta(job.dataDir, job.storyId, order, parts, {
        seconds,
        voice: narrationVoice(settings),
        engineVersion: VIENEU_VERSION,
        timings,
      });
      done++;
      job.onEvent({ type: "narrate-chapter-done", order, seconds, skipped: false, done, total });
    } catch (err) {
      if (err instanceof NarrationCancelled) break;
      failed++;
      job.onEvent({
        type: "narrate-error",
        order,
        message: err instanceof Error ? err.message : String(err),
        done,
        total,
      });
    }
  }
  return { done, failed };
}
