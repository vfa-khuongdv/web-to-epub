import { StoryStore } from "../storyStore";
import { AgentModel } from "../agent/agentConfig";
import { t } from "../lang";
import { blockText, chunkParagraphs, countWords } from "../rewrite/rewriteText";
import {
  Problem,
  Segment,
  TwistCandidate,
  WINDOW_WORDS,
  chapterFromTwists,
  parseScanReply,
  scanPrompt,
  windowSegments,
} from "./plotTwistText";

/**
 * "Plot twist" chapter for a narrated story: the agent scans the story for the twists it
 * really contains and the chapter quotes one or two sentences of each, word for word. It is stored as chapter 0, so
 * it plays first and no real chapter is renumbered (audio, highlights and uploads key on
 * the chapter order). Running it again replaces that chapter.
 */
export const PLOT_TWIST_ORDER = 0;
export const PLOT_TWIST_TITLE = "Plot twist";
const ATTEMPTS = 3;

export class PlotTwistCancelledError extends Error {}

export interface PlotTwistProgress {
  step: "scan";
  done: number;
  total: number;
}

// The same "try, validate, feed the problem back" loop as the rewrite.
async function ask<T>(
  agent: AgentModel,
  signal: AbortSignal | undefined,
  prompt: (previous?: Problem) => string,
  read: (reply: string) => T
): Promise<T> {
  let previous: Problem | undefined;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new PlotTwistCancelledError();
    let reply = "";
    let problem: string;
    try {
      reply = await agent.complete(prompt(previous));
      return read(reply);
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
    previous = { attempt: reply, problem };
  }
  throw new Error(t("The agent could not write the plot twist chapter: {reason}", { reason: previous?.problem ?? "" }));
}

export async function createPlotTwistChapter(job: {
  stories: StoryStore;
  storyId: string;
  agent: AgentModel;
  signal?: AbortSignal;
  onProgress?: (progress: PlotTwistProgress) => void;
}): Promise<{ paragraphs: number }> {
  const story = await job.stories.get(job.storyId);
  if (!story) throw new Error(t("Story not found"));

  const segments: Segment[] = [];
  for (const chapter of story.chapters) {
    if (chapter.order === PLOT_TWIST_ORDER || chapter.status !== "done") continue;
    const paragraphs = (chapter.blocks ?? [])
      .filter((block) => block.type === "paragraph")
      .map((block) => blockText(block.text ?? ""))
      .filter(Boolean);
    for (const chunk of chunkParagraphs(paragraphs, WINDOW_WORDS)) segments.push({ order: chapter.order, text: chunk.join("\n") });
  }
  if (countWords(segments.map((segment) => segment.text).join(" ")) < 200) {
    throw new Error(t("This story has no chapter text to look for a plot twist in"));
  }
  const windows = windowSegments(segments);

  const found: TwistCandidate[] = [];
  for (let index = 0; index < windows.length; index++) {
    job.onProgress?.({ step: "scan", done: index, total: windows.length });
    const window = windows[index];
    found.push(
      ...(await ask(
        job.agent,
        job.signal,
        (previous) => scanPrompt(window.text, previous),
        (reply) => parseScanReply(reply, window.orders, window.text)
      ))
    );
  }
  if (found.length === 0) throw new Error(t("The agent found no plot twist in this story"));

  const paragraphs = chapterFromTwists(found);

  await job.stories.saveChapter(job.storyId, {
    order: PLOT_TWIST_ORDER,
    url: `plot-twist:${job.storyId}`,
    title: PLOT_TWIST_TITLE,
    status: "done",
    blocks: paragraphs.map((text) => ({ type: "paragraph" as const, text })),
  });
  return { paragraphs: paragraphs.length };
}
