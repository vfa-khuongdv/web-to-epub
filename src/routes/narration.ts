import { Router } from "express";
import { estimateRemainingMs } from "../services/crawl";
import { t } from "../services/lang";
import { settingsStore } from "../services/settingsStore";
import { storyAudioBytes } from "../services/tts/audioCache";
import { NarrateEvent, chaptersToNarrate, isNarratable, narrateChapters, narrationStates } from "../services/tts/narrate";
import { ttsRuntime } from "../services/tts/runtime";
import { Library, NarrationRun, libraryFor } from "./library";
import { writeSse } from "./live";

export const narrationRouter = Router();

// What the narration channel carries: the job's own events plus its start and end.
export type NarrationLiveEvent =
  | NarrateEvent
  | { type: "narrate-running"; done: number; total: number; etaMs?: number }
  | { type: "narrate-idle"; done: number; failed: number; total: number; cancelled: boolean };

function publishNarration(library: Library, storyId: string, event: NarrationLiveEvent) {
  const tagged = { ...event, storyId };
  for (const res of library.narrationSubscribers) {
    if (!writeSse(res, tagged)) library.narrationSubscribers.delete(res);
  }
}

const narrationSettings = () => {
  const { ttsVariant, ttsVoice } = settingsStore.get();
  return { variant: ttsVariant, voice: ttsVoice };
};

// Shared channel for the open library: every running job on connect, then all events
// tagged with storyId. A story page listens here instead of per story, like the crawl
// channel, so a reload mid-job picks the job up again.
narrationRouter.get("/narration/live", (req, res) => {
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
    narrations: [...library.runningNarrations.entries()].map(([storyId, run]) => ({
      storyId,
      done: run.done,
      total: run.total,
      etaMs: run.etaMs,
      order: run.order,
      part: run.part,
      parts: run.parts,
    })),
  });
  library.narrationSubscribers.add(res);
  const beat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
  }, 20_000);
  req.on("close", () => {
    clearInterval(beat);
    library.narrationSubscribers.delete(res);
  });
});

// Per-chapter audio state for the story page, plus what is on disk. Chapters are read
// one at a time to compare their text against the saved audio.
narrationRouter.get("/stories/:id/narration", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const narratable = isNarratable(story);
  const [chapters, bytes] = narratable
    ? await Promise.all([
        narrationStates(library.stories, library.dataDir, story.id, narrationSettings()),
        storyAudioBytes(library.dataDir, story.id),
      ])
    : [{}, 0];
  const run = library.runningNarrations.get(story.id);
  res.json({
    narratable,
    chapters,
    bytes,
    running: run ? { done: run.done, total: run.total, etaMs: run.etaMs, order: run.order, part: run.part, parts: run.parts } : null,
  });
});

narrationRouter.post("/stories/:id/narrate", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { id } = req.params;
  const story = await library.stories.getOutline(id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  if (!isNarratable(story)) {
    res.status(400).json({ message: t("Narration is only available for Vietnamese stories") });
    return;
  }
  if ((await ttsRuntime.status()).state !== "installed") {
    res.status(409).json({ message: t("Narration is not installed — install it in Settings → Narration") });
    return;
  }
  if (library.runningNarrations.has(id)) {
    res.status(409).json({ message: t("This story is already being narrated") });
    return;
  }

  const body = (req.body ?? {}) as { orders?: unknown };
  const orders = Array.isArray(body.orders) ? body.orders.filter((o): o is number => Number.isInteger(o)) : undefined;
  const plan = await chaptersToNarrate(library.stories, id, orders);

  const abort = new AbortController();
  const startedAt = Date.now();
  const run: NarrationRun = { done: 0, total: plan.length, startedAt, abort };
  library.runningNarrations.set(id, run);
  res.status(202).json({ started: true, total: plan.length });
  publishNarration(library, id, { type: "narrate-running", done: 0, total: plan.length });

  // ETA from chapters actually synthesized: already-narrated chapters are skipped in
  // milliseconds and would make the estimate absurdly short.
  let synthesized = 0;
  let processed = 0;
  let result = { done: 0, failed: 0 };
  try {
    result = await narrateChapters(
      {
        stories: library.stories,
        dataDir: library.dataDir,
        storyId: id,
        settings: narrationSettings,
        runtime: ttsRuntime,
        signal: abort.signal,
        onEvent: (event) => {
          run.done = event.done;
          if (event.type === "narrate-progress") {
            run.order = event.order;
            run.part = event.part;
            run.parts = event.parts;
          } else {
            processed++;
            if (event.type === "narrate-chapter-done" && !event.skipped) synthesized++;
            run.etaMs = estimateRemainingMs({
              startedAt,
              completed: synthesized,
              total: synthesized + (plan.length - processed),
            });
          }
          publishNarration(library, id, { ...event, ...(event.type === "narrate-progress" ? {} : { etaMs: run.etaMs }) });
        },
      },
      plan
    );
  } catch (err) {
    publishNarration(library, id, {
      type: "narrate-error",
      message: err instanceof Error ? err.message : String(err),
      done: run.done,
      total: plan.length,
    });
  } finally {
    library.runningNarrations.delete(id);
    publishNarration(library, id, {
      type: "narrate-idle",
      done: result.done,
      failed: result.failed,
      total: plan.length,
      cancelled: abort.signal.aborted,
    });
  }
});

narrationRouter.post("/stories/:id/narrate/stop", (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const run = library.runningNarrations.get(req.params.id);
  if (!run) {
    res.status(404).json({ message: t("This story is not being narrated") });
    return;
  }
  run.abort.abort();
  res.json({ stopping: true });
});
