import { createRouter } from "./asyncRouter";
import { activeAgent } from "../services/agent/agentConfig";
import { t } from "../services/lang";
import { createPlotTwistChapter, PlotTwistCancelledError, PLOT_TWIST_ORDER } from "../services/plotTwist/plotTwistChapter";
import { isNarratable } from "../services/tts/narrate";
import { libraryFor, PlotTwistRun } from "./library";

/**
 * The "Plot twist" chapter (services/plotTwist/): the agent finds the twists a story really
 * has and writes one chapter, stored first (chapter 0). The run takes minutes, so POST
 * answers 202 and the page polls GET.
 */
export const plotTwistRouter = createRouter();

plotTwistRouter.get("/stories/:id/plot-twist", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const run = library.plotTwistRuns.get(story.id);
  res.json({
    narratable: isNarratable(story),
    ready: Boolean(activeAgent()),
    exists: story.chapters.some((chapter) => chapter.order === PLOT_TWIST_ORDER),
    run: run && { status: run.status, step: run.step, done: run.done, total: run.total, error: run.error },
  });
});

plotTwistRouter.post("/stories/:id/plot-twist", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  if (!isNarratable(story)) {
    res.status(400).json({ message: t("Only Vietnamese stories can have a plot twist chapter") });
    return;
  }
  if (library.plotTwistRuns.get(story.id)?.status === "running" || library.runningRewrites.has(story.id)) {
    res.status(409).json({ message: t("The agent is already working on this story") });
    return;
  }
  const agent = activeAgent();
  if (!agent) {
    res.status(409).json({ message: t("The agent crawler is off or its agent is not installed (Settings → Agent crawler)") });
    return;
  }

  // Reserved before the first await so a second click cannot start a parallel run.
  const run: PlotTwistRun = { status: "running", done: 0, total: 0, abort: new AbortController() };
  library.plotTwistRuns.set(story.id, run);
  res.status(202).json({ started: true });

  void createPlotTwistChapter({
    stories: library.stories,
    storyId: story.id,
    agent,
    signal: run.abort.signal,
    onProgress: (progress) => {
      run.step = progress.step;
      run.done = progress.done;
      run.total = progress.total;
    },
  })
    .then(() => {
      run.status = "done";
    })
    .catch((err: unknown) => {
      if (err instanceof PlotTwistCancelledError) {
        library.plotTwistRuns.delete(story.id);
        return;
      }
      run.status = "error";
      run.error = err instanceof Error ? err.message : String(err);
    });
});

plotTwistRouter.post("/stories/:id/plot-twist/stop", (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const run = library.plotTwistRuns.get(req.params.id);
  if (run?.status !== "running") {
    res.status(404).json({ message: t("No plot twist chapter is being written for this story") });
    return;
  }
  run.abort.abort();
  res.json({ stopping: true });
});
