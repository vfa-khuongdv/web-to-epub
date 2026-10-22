import { createRouter } from "./asyncRouter";
import { clearAgentActivity, onAgentActivity, recentAgentActivity } from "../services/agent/agentActivity";
import { hasAgentCrawler, rewriteCrawler } from "../services/agent/agentCrawler";
import { activeAgent, AGENTS, installedAgents, loadAgentConfig, saveAgentConfig } from "../services/agent/agentConfig";
import { listAgentModels } from "../services/agent/agentCli";
import { t } from "../services/lang";
import { libraryFor } from "./library";
import { writeSse } from "./live";

export const agentCrawlerRouter = createRouter();

// Which agents are installed is looked up on every read: the person may install one while Settings is open.
agentCrawlerRouter.get("/agent-crawler/config", (_req, res) => {
  const config = loadAgentConfig();
  const installed = installedAgents();
  res.json({
    enabled: config.enabled,
    agent: config.agent ?? null,
    model: config.model ?? "",
    // The crawler can run: it is on and the chosen agent is still there.
    ready: config.enabled && !!config.agent && installed.includes(config.agent),
    agents: AGENTS.map((a) => ({ ...a, installed: installed.includes(a.id) })),
  });
});

// The models an installed agent offers, for the picker; [] when it cannot say.
agentCrawlerRouter.get("/agent-crawler/models", async (req, res) => {
  const known = AGENTS.find((a) => a.id === req.query.agent);
  res.json({ models: known ? await listAgentModels(known.id) : [] });
});

// Body: { enabled?, agent?, model? }. Only what is present changes. Turning the crawler on with no
// agent chosen picks the first installed one.
agentCrawlerRouter.put("/agent-crawler/config", (req, res) => {
  const body = (req.body ?? {}) as { enabled?: unknown; agent?: unknown; model?: unknown };
  const config = loadAgentConfig();
  const installed = installedAgents();

  if (body.agent !== undefined) {
    const known = AGENTS.find((a) => a.id === body.agent);
    if (!known) {
      res.status(400).json({ message: t("Unknown agent") });
      return;
    }
    if (!installed.includes(known.id)) {
      res.status(400).json({ message: t("This agent is not installed on this computer") });
      return;
    }
    config.agent = known.id;
  }
  if (body.model !== undefined) {
    if (typeof body.model !== "string") {
      res.status(400).json({ message: t("model must be text") });
      return;
    }
    config.model = body.model.trim() || undefined;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ message: t("enabled must be true or false") });
      return;
    }
    config.enabled = body.enabled;
    if (config.enabled && (!config.agent || !installed.includes(config.agent))) config.agent = installed[0];
  }
  saveAgentConfig(config);
  res.json({ ok: true });
});

// What the agent is doing, live: the recent history on connect, then every step as it happens. The
// channel is process-wide (one reader), but only an open library may listen, like the others.
agentCrawlerRouter.get("/agent-crawler/live", (req, res) => {
  if (!libraryFor(req, res)) return;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 2000\n\n");
  writeSse(res, { type: "snapshot", events: recentAgentActivity() });
  const stop = onAgentActivity(
    (event) => writeSse(res, { type: "event", event }),
    () => writeSse(res, { type: "clear" })
  );
  const beat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
  }, 20_000);
  req.on("close", () => {
    clearInterval(beat);
    stop();
  });
});

// "Clear log": empties the history for every page (the live channel tells the open ones).
agentCrawlerRouter.delete("/agent-crawler/activity", (req, res) => {
  if (!libraryFor(req, res)) return;
  clearAgentActivity();
  res.json({ ok: true });
});

// Whether a story is crawled by code the agent wrote (so its details offer to rewrite it).
agentCrawlerRouter.get("/stories/:id/agent-crawler", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  let available = false;
  try {
    available = await hasAgentCrawler(story.storyUrl);
  } catch {
    /* not a web address: an imported book */
  }
  res.json({ available, ready: Boolean(activeAgent()) });
});

// Asks the agent to write the story's site crawler again — from the story page and from its first
// chapter — and keeps the old code unless the new one passes. Only the person's button does this; a
// failing crawl never rewrites by itself. Takes as long as the agent does (the live log shows it).
agentCrawlerRouter.post("/stories/:id/agent-crawler/rewrite", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : "";
  const agent = activeAgent();
  if (!agent) {
    res.status(409).json({ message: t("The agent crawler is off or its agent is not installed (Settings → Agent crawler)") });
    return;
  }
  try {
    await rewriteCrawler(agent, { storyUrl: story.storyUrl, chapterUrl: story.chapters[0]?.url, note: note || undefined });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : t("The agent could not rewrite the crawler") });
  }
});
