import { createRouter } from "./asyncRouter";
import { t } from "../services/lang";
import { loadAccount, removeAccount, saveAccount } from "../services/facebook/account";
import { fetchPage } from "../services/facebook/api";
import {
  readyFacebookCompilations,
  readyFacebookOrders,
  uploadFacebookCompilations,
  uploadFacebookVideos,
} from "../services/facebook/jobs";
import { loadYouTubeConfig } from "../services/youtube/config";
import { ChapterOrders, guardJob, ordersFrom, runEventSink, startRun, watchRun } from "./youtube";

/**
 * Facebook Page posting: the person pastes a Page id and a Page token, then posts the
 * chapter videos the YouTube render step already wrote. Videos always go up unpublished
 * (or scheduled); the job shares the story's single YouTube job slot and its live channel.
 */
export const facebookRouter = createRouter();

facebookRouter.get("/facebook/status", async (_req, res) => {
  const account = await loadAccount();
  res.json({ connected: Boolean(account), pageName: account?.pageName, pageUrl: account?.pageUrl, pageId: account?.pageId });
});

// The token is checked against the Graph API before it is saved, so a wrong id or an
// expired token is refused here and not at the first upload.
facebookRouter.put("/facebook/account", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const pageId = typeof body.pageId === "string" ? body.pageId.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^\d{5,25}$/.test(pageId) || !token) {
    res.status(400).json({ message: t("Enter the Page id (digits) and a Page access token") });
    return;
  }
  try {
    const page = await fetchPage(pageId, token);
    await saveAccount({ pageId: page.id, pageName: page.name, pageUrl: page.link, token, savedAt: new Date().toISOString() });
    res.json({ connected: true, pageName: page.name, pageUrl: page.link, pageId: page.id });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : t("Could not connect Facebook") });
  }
});

facebookRouter.delete("/facebook/account", async (_req, res) => {
  await removeAccount();
  res.json({ connected: false });
});

facebookRouter.get("/stories/:id/facebook", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const account = await loadAccount();
  res.json({
    connected: Boolean(account),
    pageName: account?.pageName,
    pageUrl: account?.pageUrl,
    videos: await library.stories.listFacebookVideos(story.id),
    ready: await readyFacebookOrders(library, story.id),
    compilations: await library.stories.listFacebookCompilations(story.id),
    readyCompilations: await readyFacebookCompilations(library, story.id),
  });
});

facebookRouter.post("/stories/:id/facebook/upload", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  if (library.runningYouTube.has(story.id)) {
    res.status(409).json({ message: t("A YouTube job is already running for this story") });
    return;
  }
  const account = await loadAccount();
  if (!account) {
    res.status(409).json({ message: t("Not signed in to Facebook — connect the Page in Settings → Facebook") });
    return;
  }
  const ready = new Set(await readyFacebookOrders(library, story.id));
  const body = (req.body ?? {}) as ChapterOrders;
  const orders = Array.isArray(body.orders) ? ordersFrom(body, ready) : [...ready].sort((a, b) => a - b);
  if (orders.length === 0) {
    res.status(400).json({ message: t("No videos are ready to post") });
    return;
  }
  const run = startRun(library, story.id, "facebook", orders.length);
  res.status(202).json({ started: true, total: orders.length });
  const job = uploadFacebookVideos({
    library,
    story,
    orders,
    account,
    channel: loadYouTubeConfig().channel,
    signal: run.abort.signal,
    onEvent: runEventSink(library, story.id, run, "facebook"),
  });
  watchRun(library, story.id, "facebook", run, job);
});

// The joined "full" video(s) of the story, with the title and description made for YouTube.
facebookRouter.post("/stories/:id/facebook/compilation/upload", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  if (library.runningYouTube.has(story.id)) {
    res.status(409).json({ message: t("A YouTube job is already running for this story") });
    return;
  }
  const account = await loadAccount();
  if (!account) {
    res.status(409).json({ message: t("Not signed in to Facebook — connect the Page in Settings → Facebook") });
    return;
  }
  const body = (req.body ?? {}) as { ids?: unknown };
  const ready = (await readyFacebookCompilations(library, story.id)).map((part) => part.id);
  const ids = Array.isArray(body.ids) ? ready.filter((id) => (body.ids as unknown[]).includes(id)) : ready;
  if (ids.length === 0) {
    res.status(400).json({ message: t("No videos are ready to post") });
    return;
  }
  const run = startRun(library, story.id, "facebook", ids.length);
  res.status(202).json({ started: true, total: ids.length });
  const job = uploadFacebookCompilations({
    library,
    story,
    ids,
    account,
    channel: loadYouTubeConfig().channel,
    signal: run.abort.signal,
    onEvent: runEventSink(library, story.id, run, "facebook"),
  });
  watchRun(library, story.id, "facebook", run, job);
});

// Drops only the app's record; the video stays on the Page.
facebookRouter.delete("/stories/:id/facebook/:order", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: t("Invalid chapter number") });
    return;
  }
  if (library.runningYouTube.has(req.params.id)) {
    res.status(409).json({ message: t("A YouTube job is already running for this story") });
    return;
  }
  await library.stories.removeFacebookVideo(req.params.id, order);
  res.json({ removed: true });
});
