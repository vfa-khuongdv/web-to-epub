import { createRouter } from "./asyncRouter";
import { activeAgent } from "../services/agent/agentConfig";
import { rewriteChapters, RewriteEvent } from "../services/rewrite/rewriteJob";
import { t } from "../services/lang";
import { isNarratable } from "../services/tts/narrate";
import { Library, libraryFor, RewriteRun } from "./library";
import { writeSse } from "./live";

/**
 * Rewriting chapters for narration with the agent (Settings → Agent crawler picks which
 * one). A job runs server-side like narration, with its own live channel; chapters are
 * written one at a time and each one is checked before it replaces the text, so a failed
 * chapter keeps its old text.
 */
export const rewriteRouter = createRouter();

export type RewriteLiveEvent =
  | RewriteEvent
  | { type: "rewrite-running"; done: number; total: number; etaMs?: number }
  | { type: "rewrite-idle"; done: number; failed: number; total: number; cancelled: boolean };

function publishRewrite(library: Library, storyId: string, event: RewriteLiveEvent): void {
  const tagged = { ...event, storyId };
  for (const res of library.rewriteSubscribers) {
    if (!writeSse(res, tagged)) library.rewriteSubscribers.delete(res);
  }
}

// The job in flight, on connect: so a page that just loaded still shows it.
rewriteRouter.get("/rewrite/live", (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 2000\n\n");
  writeSse(res, {
    type: "snapshot",
    rewrites: [...library.runningRewrites.entries()].map(([storyId, run]) => ({
      storyId,
      done: run.done,
      total: run.total,
      etaMs: run.etaMs,
      order: run.order,
      chunk: run.chunk,
      chunks: run.chunks,
    })),
  });
  library.rewriteSubscribers.add(res);
  const beat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
  }, 20_000);
  req.on("close", () => {
    clearInterval(beat);
    library.rewriteSubscribers.delete(res);
  });
});

// Which chapters are rewritten, and what a new run would take on.
rewriteRouter.get("/stories/:id/rewrite", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const rewrites = await library.stories.listRewrites(story.id);
  const byOrder = new Map(rewrites.map((rewrite) => [rewrite.order, rewrite]));
  const chapters: Record<number, { rewritten: boolean; at?: string; agent?: string }> = {};
  let remaining = 0;
  for (const chapter of story.chapters) {
    if (chapter.status !== "done") continue;
    const rewrite = byOrder.get(chapter.order);
    chapters[chapter.order] = {
      rewritten: Boolean(rewrite),
      at: rewrite?.createdAt,
      agent: rewrite?.agent,
    };
    if (!rewrite) remaining++;
  }
  const run = library.runningRewrites.get(story.id);
  res.json({
    narratable: isNarratable(story),
    ready: Boolean(activeAgent()),
    chapters,
    remaining,
    running: run
      ? { done: run.done, total: run.total, etaMs: run.etaMs, order: run.order, chunk: run.chunk, chunks: run.chunks }
      : null,
  });
});

// Body: { orders?: number[] }. Without orders: every done chapter that was not rewritten
// yet. The run takes minutes; progress goes over /rewrite/live.
rewriteRouter.post("/stories/:id/rewrite", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  if (!isNarratable(story)) {
    res.status(400).json({ message: t("Only Vietnamese stories can be rewritten for narration") });
    return;
  }
  if (library.runningRewrites.has(story.id)) {
    res.status(409).json({ message: t("This story's chapters are already being rewritten") });
    return;
  }
  const agent = activeAgent();
  if (!agent) {
    res.status(409).json({ message: t("The agent crawler is off or its agent is not installed (Settings → Agent crawler)") });
    return;
  }

  const doneOrders = new Set(story.chapters.filter((chapter) => chapter.status === "done").map((chapter) => chapter.order));
  const rewritten = new Set((await library.stories.listRewrites(story.id)).map((rewrite) => rewrite.order));
  const body = (req.body ?? {}) as { orders?: unknown };
  let orders: number[];
  if (Array.isArray(body.orders)) {
    orders = [...new Set(body.orders)]
      .filter((order): order is number => Number.isInteger(order) && doneOrders.has(order as number))
      .sort((a, b) => a - b);
  } else {
    orders = [...doneOrders].filter((order) => !rewritten.has(order)).sort((a, b) => a - b);
  }
  if (orders.length === 0) {
    res.status(400).json({ message: t("No chapters to rewrite") });
    return;
  }

  // Reserved before the first await so a second click cannot start a parallel run.
  const abort = new AbortController();
  const run: RewriteRun = { done: 0, total: orders.length, startedAt: Date.now(), abort };
  library.runningRewrites.set(story.id, run);
  res.status(202).json({ started: true, total: orders.length });

  const finish = rewriteChapters({
    stories: library.stories,
    storyId: story.id,
    storyTitle: story.title,
    orders,
    agent,
    signal: abort.signal,
    onEvent: (event) => {
      if (event.type === "rewrite-progress") {
        run.order = event.order;
        run.chunk = event.chunk;
        run.chunks = event.chunks;
      }
      if (event.type === "rewrite-chapter-done" || event.type === "rewrite-error") {
        run.done = event.done;
        run.etaMs = event.etaMs;
        if (event.order !== undefined) run.order = event.order;
      }
      publishRewrite(library, story.id, event);
    },
  });
  void finish
    .then(({ done, failed }) => {
      publishRewrite(library, story.id, {
        type: "rewrite-idle",
        done,
        failed,
        total: orders.length,
        cancelled: abort.signal.aborted,
      });
    })
    .catch((err: unknown) => {
      publishRewrite(library, story.id, {
        type: "rewrite-idle",
        done: run.done,
        failed: orders.length - run.done,
        total: orders.length,
        cancelled: abort.signal.aborted,
      });
      // The job itself catches per chapter; a throw here is unexpected and must not be silent.
      console.error("rewrite job failed", err);
    })
    .finally(() => {
      library.runningRewrites.delete(story.id);
    });
});

rewriteRouter.post("/stories/:id/rewrite/stop", (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const run = library.runningRewrites.get(req.params.id);
  if (!run) {
    res.status(404).json({ message: t("No rewrite is running for this story") });
    return;
  }
  run.abort.abort();
  res.json({ stopping: true });
});

// Put the original text back: body { orders?: number[] }, all rewritten chapters by default.
rewriteRouter.delete("/stories/:id/rewrite", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  if (library.runningRewrites.has(story.id)) {
    res.status(409).json({ message: t("This story's chapters are already being rewritten") });
    return;
  }
  const body = (req.body ?? {}) as { orders?: unknown };
  const wanted = Array.isArray(body.orders)
    ? new Set(body.orders.filter((order): order is number => Number.isInteger(order)))
    : undefined;
  const rewrites = await library.stories.listRewrites(story.id);
  let restored = 0;
  for (const rewrite of rewrites) {
    if (wanted && !wanted.has(rewrite.order)) continue;
    const full = await library.stories.getRewrite(story.id, rewrite.order);
    const chapter = full ? await library.stories.getChapter(story.id, rewrite.order) : undefined;
    if (full && chapter) {
      await library.stories.saveChapter(story.id, {
        ...chapter,
        blocks: full.originalBlocks,
        spellChecked: undefined,
      });
      restored++;
    }
    await library.stories.removeRewrite(story.id, rewrite.order);
  }
  res.json({ restored });
});
