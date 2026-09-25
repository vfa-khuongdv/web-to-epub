import { VIENEU_VERSION } from "../../config/tts";
import { StoredChapter, StoredStory } from "../../types";
import { StoryStore } from "../storyStore";
import {
  NarrationVoice,
  chapterAudioPath,
  ensureStoryAudioDir,
  narrationKey,
  readFreshAudio,
  writeAudioMeta,
} from "./audioCache";
import { chapterParts } from "./chapterText";
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

export function chapterKey(chapter: StoredChapter, settings: NarrationSettings): string | undefined {
  const parts = chapterParts(chapter.title, chapter.blocks ?? []);
  if (parts.length === 0) return undefined;
  return narrationKey(parts, narrationVoice(settings), VIENEU_VERSION);
}

/**
 * Which chapters already have audio matching their current text and the current voice.
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
    const chapter = await stories.getChapter(storyId, summary.order);
    const key = chapter && chapterKey(chapter, settings);
    states[summary.order] = key && (await readFreshAudio(dataDir, storyId, summary.order, key)) ? "ready" : "missing";
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

    const key = narrationKey(parts, narrationVoice(settings), VIENEU_VERSION);
    const cached = await readFreshAudio(job.dataDir, job.storyId, order, key);
    if (cached) {
      done++;
      job.onEvent({ type: "narrate-chapter-done", order, seconds: cached.seconds, skipped: true, done, total });
      continue;
    }

    try {
      const { seconds } = await job.runtime.withModel(settings.variant, (worker) =>
        worker.synth({
          parts,
          voice: settings.voice,
          out: chapterAudioPath(job.dataDir, job.storyId, order),
          signal: job.signal,
          onProgress: (part, count) =>
            job.onEvent({ type: "narrate-progress", order, part, parts: count, done, total }),
        })
      );
      await writeAudioMeta(job.dataDir, job.storyId, order, key, seconds);
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
