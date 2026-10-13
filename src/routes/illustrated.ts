import { createRouter } from "./asyncRouter";
import { activeAgent } from "../services/agent/agentConfig";
import { loadBible, removeBible, saveBible, writeBible } from "../services/illustrated/bible";
import { t } from "../services/lang";
import { chapterParts } from "../services/tts/chapterText";
import { guardJob } from "./youtube";

/**
 * Illustrated videos: the story's characters are drawn once by the agent and kept in the
 * library's data dir. The person looks at them here before any chapter is rendered with
 * them; generating again replaces them (and so makes every saved storyboard stale).
 */
export const illustratedRouter = createRouter();

const EXCERPT_CHAPTERS = 3;
const EXCERPT_CHARS = 9000;

illustratedRouter.get("/stories/:id/illustrated", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const bible = await loadBible(library.dataDir, req.params.id);
  res.json({ bible: bible ?? null, agentAvailable: Boolean(activeAgent()) });
});

// The first chapters are what the agent reads to find the characters and how they look.
illustratedRouter.post("/stories/:id/illustrated/bible", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const agent = activeAgent();
  if (!agent) {
    res.status(409).json({ message: t("Illustrated videos need the agent (Settings → Agent crawler) to plan the scenes") });
    return;
  }
  const orders = story.chapters
    .filter((chapter) => chapter.status === "done")
    .map((chapter) => chapter.order)
    .sort((a, b) => a - b)
    .slice(0, EXCERPT_CHAPTERS);
  let excerpt = "";
  for (const order of orders) {
    const chapter = await library.stories.getChapter(story.id, order);
    if (chapter) excerpt += `${chapterParts(chapter.title, chapter.blocks ?? []).join(" ")}\n\n`;
  }
  excerpt = excerpt.trim().slice(0, EXCERPT_CHARS);
  if (!excerpt) {
    res.status(409).json({ message: t("This story has no downloaded chapters to read yet") });
    return;
  }
  try {
    const bible = await writeBible(agent, { storyTitle: story.title, excerpt });
    await saveBible(library.dataDir, story.id, bible);
    res.json({ bible });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

illustratedRouter.delete("/stories/:id/illustrated", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  await removeBible(library.dataDir, req.params.id);
  res.status(204).end();
});
