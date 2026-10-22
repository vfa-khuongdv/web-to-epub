import { StoryStore } from "../storyStore";
import { estimateRemainingMs } from "../crawl";
import { AgentModel } from "../agent/agentConfig";
import { reportAgent } from "../agent/agentActivity";
import { RewriteCancelledError, rewriteChapterBlocks } from "./rewriteChapter";

/**
 * Rewriting a batch of chapters, one at a time (one agent conversation at a time). A
 * chapter that fails is reported and the run goes on; a stop takes effect before the next
 * chapter. The rewritten text replaces the chapter's blocks and the original is kept in
 * chapter_rewrites so it can be restored.
 */
export type RewriteEvent =
  | { type: "rewrite-progress"; order: number; chunk: number; chunks: number; done: number; total: number }
  | { type: "rewrite-chapter-done"; order: number; skipped: boolean; done: number; total: number; etaMs?: number }
  | { type: "rewrite-error"; order?: number; message: string; done: number; total: number; etaMs?: number };

export interface RewriteJob {
  stories: StoryStore;
  storyId: string;
  storyTitle: string;
  orders: number[];
  agent: AgentModel;
  signal: AbortSignal;
  onEvent: (event: RewriteEvent) => void;
}

export async function rewriteChapters(job: RewriteJob): Promise<{ done: number; failed: number }> {
  const startedAt = Date.now();
  let done = 0;
  let failed = 0;
  for (const order of job.orders) {
    if (job.signal.aborted) break;
    const chapter = await job.stories.getChapter(job.storyId, order);
    const paragraphs = (chapter?.blocks ?? []).filter((block) => block.type === "paragraph" && block.text?.trim());
    if (!chapter || chapter.status !== "done" || paragraphs.length === 0) {
      done++;
      job.onEvent({ type: "rewrite-chapter-done", order, skipped: true, done, total: job.orders.length });
      continue;
    }
    const original = chapter.blocks ?? [];
    try {
      const rewritten = await rewriteChapterBlocks(job.agent, original, {
        host: job.storyTitle,
        order,
        signal: job.signal,
        onProgress: (chunk, chunks) =>
          job.onEvent({ type: "rewrite-progress", order, chunk, chunks, done, total: job.orders.length }),
      });
      // Backup first, then the chapter: a crash in between leaves a rewrite row whose
      // blocks equal the chapter, which restores to the same text — harmless.
      await job.stories.saveRewrite(job.storyId, order, original, job.agent.name);
      await job.stories.saveChapter(job.storyId, { ...chapter, blocks: rewritten, spellChecked: undefined });
      reportAgent({ kind: "saved", host: job.storyTitle, fn: "rewrite", order, count: rewritten.length });
      done++;
      job.onEvent({
        type: "rewrite-chapter-done",
        order,
        skipped: false,
        done,
        total: job.orders.length,
        etaMs: estimateRemainingMs({ startedAt, completed: done, total: job.orders.length }),
      });
    } catch (err) {
      if (err instanceof RewriteCancelledError || job.signal.aborted) break;
      const message = err instanceof Error ? err.message : String(err);
      reportAgent({ kind: "failed", host: job.storyTitle, fn: "rewrite", order, reason: message });
      failed++;
      job.onEvent({
        type: "rewrite-error",
        order,
        message,
        done,
        total: job.orders.length,
        etaMs: estimateRemainingMs({ startedAt, completed: done, total: job.orders.length }),
      });
    }
  }
  return { done, failed };
}
