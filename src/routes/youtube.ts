import crypto from "crypto";
import fs from "fs/promises";
import { spawn } from "child_process";
import { createRouter } from "./asyncRouter";
import { activeAgent, AgentModel } from "../services/agent/agentConfig";
import { backgroundMusic } from "../services/backgroundMusic";
import { loadBible } from "../services/illustrated/bible";
import { Bible } from "../services/illustrated/types";
import { t } from "../services/lang";
import {
  accessToken,
  authUrl,
  exchangeCode,
  fetchChannel,
  loadAccount,
  pkcePair,
  readClientSecret,
  removeAccount,
  saveAccount,
  YouTubeAccount,
} from "../services/youtube/account";
import { findPlaylist } from "../services/youtube/api";
import { expandHome, loadYouTubeConfig, saveYouTubeConfig, YouTubeConfig } from "../services/youtube/config";
import {
  compilationChannelPlaylist,
  planCompilation,
  renderCompilations,
  resolveCompilationPath,
  uploadCompilations,
  withIntro,
} from "../services/youtube/compilation";
import {
  prepareYouTubeChapters,
  renderYouTubeVideos,
  resolveVideoPath,
  syncYouTubeUploads,
  uploadYouTubeVideos,
  youTubeState,
  YouTubeEvent,
  YouTubePhase,
} from "../services/youtube/jobs";
import { loadAccount as loadFacebookAccount } from "../services/facebook/account";
import {
  readyFacebookCompilations,
  readyFacebookOrders,
  uploadFacebookCompilations,
  uploadFacebookVideos,
} from "../services/facebook/jobs";
import { playlistTitle, sanitizeYouTubeText } from "../services/youtube/meta";
import { writeStoryIntro } from "../services/youtube/summarize";
import { chapterParts } from "../services/tts/chapterText";
import { findFfmpeg } from "../services/youtube/video";
import { isPrivateLibrary, Library, libraryFor } from "./library";
import { writeSse } from "./live";

/**
 * YouTube publishing: connect the user's own Google account, then prepare → render →
 * upload a story's chapters. Every step is started by the person; the app never uploads
 * or creates a playlist on its own. Upload always goes out private (optionally scheduled
 * public), and a playlist is created only when the upload request says it was confirmed.
 */
export const youtubeRouter = createRouter();

export type YouTubeLiveEvent =
  | YouTubeEvent
  | { type: "youtube-running"; phase: YouTubePhase; done: number; total: number; etaMs?: number; order?: number; percent?: number }
  | { type: "youtube-error"; phase: YouTubePhase; message: string };

function publishYouTube(library: Library, storyId: string, event: YouTubeLiveEvent): void {
  const tagged = { ...event, storyId };
  for (const res of library.youtubeSubscribers) {
    if (!writeSse(res, tagged)) library.youtubeSubscribers.delete(res);
  }
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // The connect dialog also shows the link for copying.
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function callbackPage(message: string, channel: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(channel)}</title></head><body style="font-family:sans-serif;padding:2rem"><p>${escapeHtml(message)}</p></body></html>`;
}

// Sign-ins waiting for Google to redirect back; state is single-use and expires.
const pendingFlows = new Map<
  string,
  { verifier: string; redirectUri: string; clientId: string; clientSecret: string; createdAt: number }
>();
const FLOW_TTL_MS = 10 * 60_000;

function validYouTube(library: Library, res: Parameters<typeof libraryFor>[1]): boolean {
  if (isPrivateLibrary(library)) {
    res.status(403).json({ message: t("YouTube publishing is not available in private mode") });
    return false;
  }
  return true;
}

// ---- account & settings -----------------------------------------------------

youtubeRouter.get("/youtube/status", async (_req, res) => {
  const config = loadYouTubeConfig();
  const account = await loadAccount();
  const secretFile = expandHome(config.clientSecretPath);
  res.json({
    connected: Boolean(account?.refreshToken || account?.accessToken),
    channel: account?.channelTitle,
    clientSecretPath: config.clientSecretPath,
    hasClientSecret: Boolean(await fs.stat(secretFile).catch(() => undefined)),
    ffmpeg: findFfmpeg(config.ffmpegPath) ?? null,
    config,
  });
});

youtubeRouter.put("/youtube/config", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const config = loadYouTubeConfig();
  const text = (value: unknown, max: number): string | undefined =>
    typeof value === "string" ? value.trim().slice(0, max) : undefined;
  const channel = text(body.channel, 80);
  const clientSecretPath = text(body.clientSecretPath, 500);
  const ffmpegPath = text(body.ffmpegPath, 500);
  const genreTags = text(body.genreTags, 200);
  const scheduleTime = text(body.scheduleTime, 10);
  if (channel !== undefined) config.channel = channel || config.channel;
  if (clientSecretPath !== undefined) config.clientSecretPath = clientSecretPath || config.clientSecretPath;
  if (ffmpegPath !== undefined) config.ffmpegPath = ffmpegPath;
  if (genreTags !== undefined) config.genreTags = genreTags;
  if (scheduleTime !== undefined) config.scheduleTime = scheduleTime;
  if (body.musicId !== undefined) {
    if (typeof body.musicId !== "string") {
      res.status(400).json({ message: t("musicId must be text") });
      return;
    }
    config.musicId = body.musicId || undefined;
  }
  if (body.musicVolume !== undefined) {
    const volume = Number(body.musicVolume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 4) {
      res.status(400).json({ message: t("musicVolume must be a number between 0 and 4") });
      return;
    }
    config.musicVolume = volume;
  }
  if (body.syntheticMedia !== undefined) {
    if (typeof body.syntheticMedia !== "boolean") {
      res.status(400).json({ message: t("syntheticMedia must be true or false") });
      return;
    }
    config.syntheticMedia = body.syntheticMedia;
  }
  saveYouTubeConfig(config);
  res.json({ ok: true, config });
});

// Starts the browser sign-in: the person's own OAuth client, loopback redirect, PKCE.
youtubeRouter.post("/youtube/connect", async (req, res) => {
  const config = loadYouTubeConfig();
  const body = (req.body ?? {}) as { clientSecretPath?: unknown };
  const secretPath =
    typeof body.clientSecretPath === "string" && body.clientSecretPath.trim()
      ? body.clientSecretPath.trim().slice(0, 500)
      : config.clientSecretPath;
  let secret;
  try {
    secret = await readClientSecret(secretPath);
  } catch (err) {
    res.status(400).json({ message: err instanceof Error ? err.message : t("That file is not a Google OAuth client JSON") });
    return;
  }
  if (secretPath !== config.clientSecretPath) saveYouTubeConfig({ ...config, clientSecretPath: secretPath });
  for (const [state, flow] of pendingFlows) {
    if (Date.now() - flow.createdAt > FLOW_TTL_MS) pendingFlows.delete(state);
  }
  const state = crypto.randomBytes(16).toString("hex");
  const { verifier, challenge } = pkcePair();
  const redirectUri = `http://${req.headers.host ?? "127.0.0.1:3100"}/api/youtube/callback`;
  pendingFlows.set(state, { verifier, redirectUri, clientId: secret.clientId, clientSecret: secret.clientSecret, createdAt: Date.now() });
  const url = authUrl({ clientId: secret.clientId, redirectUri, state, challenge });
  openBrowser(url);
  res.json({ url });
});

youtubeRouter.get("/youtube/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const flow = pendingFlows.get(state);
  pendingFlows.delete(state);
  if (!flow || !code) {
    res.status(400).type("html").send(callbackPage(t("Sign-in failed or expired. Open Settings → YouTube and try again."), loadYouTubeConfig().channel));
    return;
  }
  try {
    const tokens = await exchangeCode({
      clientId: flow.clientId,
      clientSecret: flow.clientSecret,
      code,
      verifier: flow.verifier,
      redirectUri: flow.redirectUri,
    });
    const account: YouTubeAccount = {
      clientId: flow.clientId,
      clientSecret: flow.clientSecret,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      savedAt: new Date().toISOString(),
    };
    const channel = await fetchChannel(tokens.access_token);
    if (channel) {
      account.channelId = channel.id;
      account.channelTitle = channel.title;
    }
    await saveAccount(account);
    res
      .type("html")
      .send(callbackPage(t("YouTube connected: {channel}. You can close this tab.", { channel: channel?.title ?? "" }), loadYouTubeConfig().channel));
  } catch (err) {
    res.status(502).type("html").send(callbackPage(err instanceof Error ? err.message : t("Could not connect YouTube"), loadYouTubeConfig().channel));
  }
});

youtubeRouter.delete("/youtube/account", async (_req, res) => {
  await removeAccount();
  res.json({ ok: true });
});

// The job in flight, on connect.
youtubeRouter.get("/youtube/live", (req, res) => {
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
    jobs: [...library.runningYouTube.entries()].map(([storyId, run]) => ({
      storyId,
      phase: run.phase,
      done: run.done,
      total: run.total,
      etaMs: run.etaMs,
      order: run.order,
      percent: run.percent,
    })),
  });
  library.youtubeSubscribers.add(res);
  const beat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
  }, 20_000);
  req.on("close", () => {
    clearInterval(beat);
    library.youtubeSubscribers.delete(res);
  });
});

// ---- per story --------------------------------------------------------------

youtubeRouter.get("/stories/:id/youtube", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library || !validYouTube(library, res)) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const config = loadYouTubeConfig();
  const state = await youTubeState(library, story, config);
  const compilations = await library.stories.listCompilations(story.id, "youtube");
  const facebookCompilations = await library.stories.listCompilations(story.id, "facebook");
  const run = library.runningYouTube.get(story.id);
  res.json({
    ...state,
    compilationPlaylist: compilationChannelPlaylist(story.title, config.channel),
    compilations,
    facebookCompilations,
    running: run
      ? { phase: run.phase, done: run.done, total: run.total, etaMs: run.etaMs, order: run.order, percent: run.percent }
      : null,
  });
});

export interface ChapterOrders {
  orders?: unknown;
}

export function ordersFrom(body: ChapterOrders, allowed: Set<number>): number[] {
  if (!Array.isArray(body.orders)) return [];
  return [...new Set(body.orders)]
    .filter((order): order is number => Number.isInteger(order) && allowed.has(order as number))
    .sort((a, b) => a - b);
}

export function startRun(library: Library, storyId: string, phase: YouTubePhase, total: number) {
  const abort = new AbortController();
  const run = { phase, done: 0, total, startedAt: Date.now(), abort };
  library.runningYouTube.set(storyId, run);
  // The panel has to know a job started before its first chapter ends: a compilation part
  // can take minutes (join + encode), so without this the UI sat silent at 0%.
  publishYouTube(library, storyId, { type: "youtube-running", phase, done: 0, total });
  return run;
}

export function watchRun(
  library: Library,
  storyId: string,
  phase: YouTubePhase,
  run: { done: number; total: number; abort: AbortController },
  job: Promise<{ done: number; failed: number; message?: string }>
): void {
  void job
    .then(({ done, failed, message }) => {
      publishYouTube(library, storyId, {
        type: "youtube-idle",
        phase,
        done,
        failed,
        total: run.total,
        cancelled: run.abort.signal.aborted,
        message,
      });
    })
    .catch((err: unknown) => {
      publishYouTube(library, storyId, {
        type: "youtube-error",
        phase,
        message: err instanceof Error ? err.message : t("The YouTube job failed"),
      });
      publishYouTube(library, storyId, {
        type: "youtube-idle",
        phase,
        done: run.done,
        failed: run.total - run.done,
        total: run.total,
        cancelled: run.abort.signal.aborted,
      });
    })
    .finally(() => {
      library.runningYouTube.delete(storyId);
    });
}

interface JobResult {
  done: number;
  failed: number;
  message?: string;
}

/**
 * One publish run for both destinations: when the YouTube job is over (and was not
 * stopped) the same run goes on with the Facebook Page, so the person confirms once and the
 * story's single job slot stays taken until both are done. The summary keeps the YouTube
 * failures and the Facebook count.
 */
export function thenFacebook(
  library: Library,
  storyId: string,
  run: { phase: YouTubePhase; done: number; total: number; order?: number; percent?: number; abort: AbortController },
  first: Promise<JobResult>,
  second: { total: number; start: () => Promise<JobResult> }
): Promise<JobResult> {
  return first.then(async (result) => {
    if (run.abort.signal.aborted) return result;
    run.phase = "facebook";
    run.done = 0;
    run.total = second.total;
    run.order = undefined;
    run.percent = undefined;
    publishYouTube(library, storyId, { type: "youtube-running", phase: "facebook", done: 0, total: second.total });
    const next = await second.start();
    return {
      done: next.done,
      failed: result.failed + next.failed,
      message: [result.message, next.message].filter(Boolean).join(" ") || undefined,
    };
  });
}

export function runEventSink(
  library: Library,
  storyId: string,
  run: { done: number; total: number; order?: number; percent?: number; etaMs?: number },
  phase: YouTubePhase
) {
  return (event: YouTubeEvent) => {
    if (event.type === "youtube-progress") {
      run.order = event.order;
      run.percent = event.percent;
    }
    if (event.type === "youtube-chapter-done") {
      run.done = event.done;
      run.order = event.order;
      run.etaMs = event.etaMs;
      run.percent = undefined;
    }
    publishYouTube(library, storyId, event);
  };
}

// "illustrated" draws scenes with the story's characters instead of the still cover. Returns
// the bible and agent to use, undefined for the cover, or null after answering 409 (the
// characters are not drawn yet).
async function illustratedFrom(
  library: Library,
  storyId: string,
  style: unknown,
  res: Parameters<typeof libraryFor>[1]
): Promise<{ bible: Bible; agent?: AgentModel } | undefined | null> {
  if (style !== "illustrated") return undefined;
  const bible = await loadBible(library.dataDir, storyId);
  if (!bible) {
    res.status(409).json({ message: t("Draw the story's characters first (Publish → Video style)") });
    return null;
  }
  return { bible, agent: activeAgent() };
}

// Which platform a compilation is cut for: YouTube parts run up to 11 h, Facebook's up to 4 h.
function platformFrom(body: { platform?: unknown }): "youtube" | "facebook" {
  return body.platform === "facebook" ? "facebook" : "youtube";
}

export function guardJob(req: Parameters<typeof libraryFor>[0], res: Parameters<typeof libraryFor>[1]) {
  const library = libraryFor(req, res);
  if (!library || !validYouTube(library, res)) return null;
  return library;
}

// Fills the draft title/description/tags for the chosen chapters; the agent writes the
// summary when it is on. Nothing is uploaded and no playlist is created here.
youtubeRouter.post("/stories/:id/youtube/prepare", async (req, res) => {
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
  const config = loadYouTubeConfig();
  const body = (req.body ?? {}) as ChapterOrders & {
    musicId?: unknown;
    musicVolume?: unknown;
    publishAt?: unknown;
    author?: unknown;
    translator?: unknown;
    genreTags?: unknown;
  };
  const allowed = new Set(story.chapters.filter((chapter) => chapter.status === "done").map((chapter) => chapter.order));
  const orders = ordersFrom(body, allowed);
  if (orders.length === 0) {
    res.status(400).json({ message: t("Choose at least one chapter") });
    return;
  }
  let music: { id?: string; volume?: number } | undefined;
  if (body.musicId !== undefined) {
    if (typeof body.musicId !== "string") {
      res.status(400).json({ message: t("musicId must be text") });
      return;
    }
    if (body.musicId) {
      const track = await backgroundMusic.get(body.musicId);
      if (!track) {
        res.status(400).json({ message: t("Background music track not found") });
        return;
      }
    }
    const volume = body.musicVolume === undefined ? config.musicVolume : Number(body.musicVolume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 4) {
      res.status(400).json({ message: t("musicVolume must be a number between 0 and 4") });
      return;
    }
    music = { id: body.musicId || undefined, volume };
  }
  const publishAt: Record<number, string> = {};
  if (body.publishAt && typeof body.publishAt === "object") {
    for (const [key, value] of Object.entries(body.publishAt as Record<string, unknown>)) {
      const order = Number(key);
      if (Number.isInteger(order) && typeof value === "string" && value.trim()) publishAt[order] = value.trim();
    }
  }
  const text = (value: unknown, max: number): string | undefined =>
    typeof value === "string" ? value.trim().slice(0, max) : undefined;

  const run = startRun(library, story.id, "prepare", orders.length);
  res.status(202).json({ started: true, total: orders.length });
  const job = prepareYouTubeChapters({
    library,
    story,
    orders,
    agent: activeAgent(),
    config,
    music,
    publishAt,
    author: text(body.author, 200),
    translator: text(body.translator, 200),
    genreTags: text(body.genreTags, 200),
    signal: run.abort.signal,
    onEvent: runEventSink(library, story.id, run, "prepare"),
  });
  watchRun(library, story.id, "prepare", run, job);
});

// Makes the MP4s for chapters whose info is ready. Files only; nothing leaves the machine.
youtubeRouter.post("/stories/:id/youtube/render", async (req, res) => {
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
  const config = loadYouTubeConfig();
  if (!findFfmpeg(config.ffmpegPath)) {
    res.status(409).json({
      message: t("ffmpeg was not found. Install it (for example: brew install ffmpeg) or set its path in Settings → YouTube."),
    });
    return;
  }
  const body = (req.body ?? {}) as ChapterOrders & { musicId?: unknown; musicVolume?: unknown; style?: unknown };
  const illustrated = await illustratedFrom(library, story.id, body.style, res);
  if (illustrated === null) return;
  if (!illustrated && !library.covers.find(story.id)) {
    res.status(409).json({ message: t("This story has no cover image yet — add one before making videos") });
    return;
  }
  const videos = await library.stories.listYouTubeVideos(story.id);
  const ready = new Set(videos.filter((video) => video.status !== "uploaded").map((video) => video.order));
  const orders = Array.isArray(body.orders) ? ordersFrom(body, ready) : [...ready].sort((a, b) => a - b);
  if (orders.length === 0) {
    res.status(400).json({ message: t("No chapters are ready to render") });
    return;
  }
  let music: { id?: string; volume?: number } | undefined;
  if (body.musicId !== undefined) {
    if (typeof body.musicId !== "string") {
      res.status(400).json({ message: t("musicId must be text") });
      return;
    }
    if (body.musicId && !(await backgroundMusic.get(body.musicId))) {
      res.status(400).json({ message: t("Background music track not found") });
      return;
    }
    const volume = body.musicVolume === undefined ? config.musicVolume : Number(body.musicVolume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 4) {
      res.status(400).json({ message: t("musicVolume must be a number between 0 and 4") });
      return;
    }
    music = { id: body.musicId || undefined, volume };
  }
  const run = startRun(library, story.id, "render", orders.length);
  res.status(202).json({ started: true, total: orders.length });
  const job = renderYouTubeVideos({
    library,
    story,
    orders,
    config,
    music,
    illustrated,
    signal: run.abort.signal,
    onEvent: runEventSink(library, story.id, run, "render"),
  });
  watchRun(library, story.id, "render", run, job);
});

// The story-level credits the upload info is built from. Kept separate from prepare so
// they can be saved without selecting chapters or calling the agent.
youtubeRouter.patch("/stories/:id/youtube", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const text = (value: unknown, max: number): string | undefined =>
    typeof value === "string" ? value.trim().slice(0, max) : undefined;
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && typeof value !== "string") {
      res.status(400).json({ message: t("{field} must be text", { field: key }) });
      return;
    }
  }
  const config = loadYouTubeConfig();
  const existing = await library.stories.getYouTubeStory(story.id);
  const now = new Date().toISOString();
  await library.stories.saveYouTubeStory({
    storyId: story.id,
    playlistTitle: existing?.playlistTitle ?? playlistTitle(story.title, config.channel),
    playlistId: existing?.playlistId,
    playlistUrl: existing?.playlistUrl,
    playlistCheckedAt: existing?.playlistCheckedAt,
    author: text(body.author, 200) ?? existing?.author ?? story.author,
    translator: text(body.translator, 200) ?? existing?.translator,
    genreTags: text(body.genreTags, 200) ?? existing?.genreTags ?? config.genreTags,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  res.json({ ok: true });
});

// Marks the chapters already on the channel as uploaded (videos made by the upload
// script are not in this library's tables). Read-only against YouTube; safe to repeat.
youtubeRouter.post("/stories/:id/youtube/sync", async (req, res) => {
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
    res.status(409).json({ message: t("Not signed in to YouTube — connect the account in Settings → YouTube") });
    return;
  }
  try {
    const result = await syncYouTubeUploads({ library, story, config: loadYouTubeConfig(), account });
    res.json(result);
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : t("YouTube request failed") });
  }
});

// Writes the compilation's story intro with the agent, from the first selected chapters
// (the person can edit it before making the videos).
youtubeRouter.post("/stories/:id/youtube/compilation/intro", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const agent = activeAgent();
  if (!agent) {
    res.status(409).json({ message: t("The agent crawler is off or its agent is not installed (Settings → Agent crawler)") });
    return;
  }
  const body = (req.body ?? {}) as ChapterOrders;
  const allowed = new Set(story.chapters.filter((chapter) => chapter.status === "done").map((chapter) => chapter.order));
  const orders = ordersFrom(body, allowed);
  if (orders.length === 0) {
    res.status(400).json({ message: t("Choose at least one chapter") });
    return;
  }
  try {
    const text: string[] = [];
    let words = 0;
    // The start of the story is enough for a 2–3 sentence intro; cap it so the prompt stays small.
    for (const order of orders.slice(0, 3)) {
      const chapter = await library.stories.getChapter(story.id, order);
      if (!chapter?.blocks) continue;
      text.push(chapterParts(chapter.title, chapter.blocks).join(" "));
      words += text[text.length - 1].split(/\s+/).length;
      if (words >= 2500) break;
    }
    const intro = await writeStoryIntro(agent, { storyTitle: story.title, text: text.join("\n\n") });
    res.json({ intro });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : t("The agent could not write the intro") });
  }
});

// Puts the current intro into the descriptions of the parts already rendered — the videos
// may have been made before the intro was written. Only the 📖 line changes; contents,
// credits and hashtags stay as the render wrote them, and uploaded parts are left alone
// (their description lives on YouTube).
youtubeRouter.post("/stories/:id/youtube/compilation/description", async (req, res) => {
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
  const body = (req.body ?? {}) as { intro?: unknown };
  if (typeof body.intro !== "string" || !body.intro.trim()) {
    res.status(400).json({ message: t("The intro cannot be empty") });
    return;
  }
  const intro = body.intro.trim().slice(0, 2000);
  const records = [
    ...(await library.stories.listCompilations(story.id, "youtube")),
    ...(await library.stories.listCompilations(story.id, "facebook")),
  ].filter((record) => record.status === "rendered" || record.status === "error");
  for (const record of records) {
    await library.stories.saveCompilation({
      ...record,
      storyId: story.id,
      description: withIntro(record.description ?? "", intro),
      updatedAt: new Date().toISOString(),
    });
  }
  res.json({ updated: records.length });
});

// Plans the story's compilation: how many parts the chosen chapters make, and any
// chapter still missing narration audio.
youtubeRouter.post("/stories/:id/youtube/compilation/plan", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const body = (req.body ?? {}) as ChapterOrders;
  const allowed = new Set(story.chapters.filter((chapter) => chapter.status === "done").map((chapter) => chapter.order));
  const orders = ordersFrom(body, allowed);
  if (orders.length === 0) {
    res.status(400).json({ message: t("Choose at least one chapter") });
    return;
  }
  const plan = await planCompilation(library, story.id, orders, platformFrom((req.body ?? {}) as { platform?: unknown }));
  res.json({
    totalHours: plan.totalHours,
    missing: plan.missing,
    parts: plan.parts.map(({ part, from, to, hours }) => ({ part, from, to, hours })),
  });
});

// Joins the chosen chapters into one long video per part. Files only; nothing leaves the
// machine, and it never runs without the person pressing the button.
youtubeRouter.post("/stories/:id/youtube/compilation", async (req, res) => {
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
  const config = loadYouTubeConfig();
  if (!findFfmpeg(config.ffmpegPath)) {
    res.status(409).json({
      message: t("ffmpeg was not found. Install it (for example: brew install ffmpeg) or set its path in Settings → YouTube."),
    });
    return;
  }
  const body = (req.body ?? {}) as ChapterOrders & {
    platform?: unknown;
    style?: unknown;
    intro?: unknown;
    labelWord?: unknown;
    musicId?: unknown;
    musicVolume?: unknown;
    publishAt?: unknown;
  };
  const allowed = new Set(story.chapters.filter((chapter) => chapter.status === "done").map((chapter) => chapter.order));
  const orders = ordersFrom(body, allowed);
  if (orders.length === 0) {
    res.status(400).json({ message: t("Choose at least one chapter") });
    return;
  }
  const illustrated = await illustratedFrom(library, story.id, body.style, res);
  if (illustrated === null) return;
  const platform = platformFrom(body);
  const plan = await planCompilation(library, story.id, orders, platform);
  if (plan.missing.length > 0) {
    res.status(400).json({
      message: t("Chapter {order} has no audio yet — narrate it first", { order: plan.missing[0] }),
    });
    return;
  }
  let music: { id?: string; volume?: number } | undefined;
  if (body.musicId !== undefined) {
    if (typeof body.musicId !== "string") {
      res.status(400).json({ message: t("musicId must be text") });
      return;
    }
    if (body.musicId && !(await backgroundMusic.get(body.musicId))) {
      res.status(400).json({ message: t("Background music track not found") });
      return;
    }
    const volume = body.musicVolume === undefined ? config.musicVolume : Number(body.musicVolume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 4) {
      res.status(400).json({ message: t("musicVolume must be a number between 0 and 4") });
      return;
    }
    music = { id: body.musicId || undefined, volume };
  }
  const publishAt: Record<number, string> = {};
  if (body.publishAt && typeof body.publishAt === "object") {
    for (const [key, value] of Object.entries(body.publishAt as Record<string, unknown>)) {
      const part = Number(key);
      if (Number.isInteger(part) && typeof value === "string" && value.trim()) publishAt[part] = value.trim();
    }
  }

  const run = startRun(library, story.id, "compilation", plan.parts.length);
  res.status(202).json({ started: true, total: plan.parts.length, parts: plan.parts.length });
  const job = renderCompilations({
    library,
    story,
    config,
    orders,
    intro: typeof body.intro === "string" ? body.intro.trim().slice(0, 2000) : undefined,
    labelWord: typeof body.labelWord === "string" ? body.labelWord.trim().slice(0, 40) : undefined,
    music,
    platform,
    illustrated,
    publishAt,
    signal: run.abort.signal,
    onEvent: runEventSink(library, story.id, run, "compilation"),
  });
  watchRun(library, story.id, "compilation", run, job);
});

// Uploads the rendered parts, always private and only after the confirmation the UI asks
// for: into the story's compilation playlist ("<Truyện> – Trọn bộ", created only when the
// person confirmed it), or with no playlist at all when the dialog turned it off.
youtubeRouter.post("/stories/:id/youtube/compilation/upload", async (req, res) => {
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
    res.status(409).json({ message: t("Not signed in to YouTube — connect the account in Settings → YouTube") });
    return;
  }
  const config = loadYouTubeConfig();
  const body = (req.body ?? {}) as { ids?: unknown; createPlaylist?: unknown; withPlaylist?: unknown; facebook?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : undefined;
  const ready = (await library.stories.listCompilations(story.id, "youtube")).filter(
    (record) =>
      (ids === undefined || ids.includes(record.id)) &&
      (record.status === "rendered" || record.status === "error" || record.status === "uploading")
  );
  if (ready.length === 0) {
    res.status(400).json({ message: t("No videos are ready to upload") });
    return;
  }
  const createPlaylist = body.createPlaylist === true;
  // The dialog can upload without a playlist: then nothing is created and nothing is added.
  const withPlaylist = body.withPlaylist !== false;
  let token: string;
  try {
    token = await accessToken(account);
  } catch (err) {
    res.status(409).json({ message: err instanceof Error ? err.message : t("Could not connect YouTube") });
    return;
  }
  if (withPlaylist) {
    const title = compilationChannelPlaylist(story.title, config.channel);
    try {
      const existing = await findPlaylist(token, title);
      if (!existing && !createPlaylist) {
        res.status(409).json({
          code: "playlist-missing",
          playlistName: title,
          message: t("The playlist \"{name}\" does not exist yet", { name: title }),
        });
        return;
      }
    } catch (err) {
      res.status(502).json({ message: err instanceof Error ? err.message : t("YouTube request failed") });
      return;
    }
  }

  // Also post these parts to the Facebook Page when the YouTube upload is over.
  const facebookAccount = Array.isArray(body.facebook) ? await loadFacebookAccount() : undefined;
  if (Array.isArray(body.facebook) && !facebookAccount) {
    res.status(409).json({ message: t("Not signed in to Facebook — connect the Page in Settings → Facebook") });
    return;
  }
  const facebookIds = Array.isArray(body.facebook)
    ? (await readyFacebookCompilations(library, story.id)).map((part) => part.id).filter((id) => (body.facebook as unknown[]).includes(id))
    : [];

  const run = startRun(library, story.id, "compilation", ready.length);
  res.status(202).json({ started: true, total: ready.length });
  const job = uploadCompilations({
    library,
    story,
    config,
    account,
    ids,
    createPlaylist,
    withPlaylist,
    signal: run.abort.signal,
    onEvent: runEventSink(library, story.id, run, "compilation"),
  });
  watchRun(
    library,
    story.id,
    "compilation",
    run,
    facebookAccount && facebookIds.length > 0
      ? thenFacebook(library, story.id, run, job, {
          total: facebookIds.length,
          start: () =>
            uploadFacebookCompilations({
              library,
              story,
              ids: facebookIds,
              account: facebookAccount,
              channel: config.channel,
              signal: run.abort.signal,
              onEvent: runEventSink(library, story.id, run, "facebook"),
            }),
        })
      : job
  );
});

// Drop a part's record and its rendered file (the YouTube video, if any, stays).
youtubeRouter.delete("/stories/:id/youtube/compilation/:compilationId", async (req, res) => {
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
  const record = await library.stories.getCompilation(story.id, req.params.compilationId);
  if (!record) {
    res.status(404).json({ message: t("No video for this chapter yet") });
    return;
  }
  const file = resolveCompilationPath(library.dataDir, story.id, record);
  if (file) await fs.rm(file, { force: true });
  await library.stories.removeCompilation(story.id, req.params.compilationId);
  res.json({ ok: true });
});

// Serves a rendered part for the preview player.
youtubeRouter.get("/stories/:id/youtube/compilation/:compilationId/video", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const record = await library.stories.getCompilation(story.id, req.params.compilationId);
  const file = record ? resolveCompilationPath(library.dataDir, story.id, record) : undefined;
  if (!file || !(await fs.stat(file).catch(() => undefined))) {
    res.status(404).json({ message: t("No video for this chapter yet") });
    return;
  }
  res.type("video/mp4");
  res.sendFile(file);
});

// Reschedules or edits a rendered part — the title/description/tags the description
// carries (hashtags included), like a chapter's info. "Apply schedule" sends publishAt.
// Only the local record changes, and only while the part is not on YouTube yet.
youtubeRouter.patch("/stories/:id/youtube/compilation/:compilationId", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const record = await library.stories.getCompilation(story.id, req.params.compilationId);
  if (!record) {
    res.status(404).json({ message: t("No video for this chapter yet") });
    return;
  }
  if (record.status === "uploaded") {
    res.status(409).json({ message: t("This part is already on YouTube — its publish time cannot be changed here") });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, string | undefined> = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      res.status(400).json({ message: t("The title cannot be empty") });
      return;
    }
    const title = sanitizeYouTubeText(body.title.trim()).slice(0, 100);
    if (!title) {
      res.status(400).json({ message: t("The title cannot be empty") });
      return;
    }
    patch.title = title;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      res.status(400).json({ message: t("description must be text") });
      return;
    }
    patch.description = sanitizeYouTubeText(body.description).slice(0, 5000);
  }
  if (body.tags !== undefined) {
    if (typeof body.tags !== "string") {
      res.status(400).json({ message: t("tags must be text") });
      return;
    }
    patch.tags = sanitizeYouTubeText(body.tags).slice(0, 500);
  }
  if (body.publishAt !== undefined) {
    if (body.publishAt === null || body.publishAt === "") patch.publishAt = undefined;
    else if (typeof body.publishAt === "string") patch.publishAt = body.publishAt.trim().slice(0, 40);
    else {
      res.status(400).json({ message: t("publishAt must be an ISO 8601 time") });
      return;
    }
  }
  const next = { ...record, ...patch, updatedAt: new Date().toISOString() };
  await library.stories.saveCompilation({ ...next, storyId: story.id });
  res.json({ record: next });
});

// Uploads private, optionally scheduled, and adds each video to the story's playlist.
// A missing playlist needs the person's confirmation: without createPlaylist the request
// is refused with the name, and the UI asks before calling again.
youtubeRouter.post("/stories/:id/youtube/upload", async (req, res) => {
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
    res.status(409).json({ message: t("Not signed in to YouTube — connect the account in Settings → YouTube") });
    return;
  }
  const config = loadYouTubeConfig();
  const body = (req.body ?? {}) as ChapterOrders & { createPlaylist?: unknown; facebook?: unknown };
  const videos = await library.stories.listYouTubeVideos(story.id);
  const ready = new Set(
    videos.filter((video) => video.status === "rendered" || video.status === "error").map((video) => video.order)
  );
  const orders = Array.isArray(body.orders) ? ordersFrom(body, ready) : [...ready].sort((a, b) => a - b);
  if (orders.length === 0) {
    res.status(400).json({ message: t("No videos are ready to upload") });
    return;
  }
  const createPlaylist = body.createPlaylist === true;
  // Also post to the Facebook Page when this run is over: the chapters named in `facebook`.
  const facebookAccount = Array.isArray(body.facebook) ? await loadFacebookAccount() : undefined;
  if (Array.isArray(body.facebook) && !facebookAccount) {
    res.status(409).json({ message: t("Not signed in to Facebook — connect the Page in Settings → Facebook") });
    return;
  }
  const facebookReady = new Set(await readyFacebookOrders(library, story.id));
  const facebookOrders = Array.isArray(body.facebook) ? ordersFrom({ orders: body.facebook }, facebookReady) : [];
  let token: string;
  try {
    token = await accessToken(account);
  } catch (err) {
    res.status(409).json({ message: err instanceof Error ? err.message : t("Could not connect YouTube") });
    return;
  }
  const storyRecord = await library.stories.getYouTubeStory(story.id);
  const title = storyRecord?.playlistTitle ?? playlistTitle(story.title, config.channel);
  try {
    const existing = await findPlaylist(token, title);
    if (!existing && !createPlaylist) {
      res.status(409).json({
        code: "playlist-missing",
        playlistName: title,
        message: t("The playlist \"{name}\" does not exist yet", { name: title }),
      });
      return;
    }
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : t("YouTube request failed") });
    return;
  }

  const run = startRun(library, story.id, "upload", orders.length);
  res.status(202).json({ started: true, total: orders.length });
  const job = uploadYouTubeVideos({
    library,
    story,
    orders,
    config,
    account,
    createPlaylist,
    signal: run.abort.signal,
    onEvent: runEventSink(library, story.id, run, "upload"),
  });
  watchRun(
    library,
    story.id,
    "upload",
    run,
    facebookAccount && facebookOrders.length > 0
      ? thenFacebook(library, story.id, run, job, {
          total: facebookOrders.length,
          start: () =>
            uploadFacebookVideos({
              library,
              story,
              orders: facebookOrders,
              account: facebookAccount,
              channel: config.channel,
              signal: run.abort.signal,
              onEvent: runEventSink(library, story.id, run, "facebook"),
            }),
        })
      : job
  );
});

youtubeRouter.post("/stories/:id/youtube/stop", (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const run = library.runningYouTube.get(req.params.id);
  if (!run) {
    res.status(404).json({ message: t("No YouTube job is running for this story") });
    return;
  }
  run.abort.abort();
  res.json({ stopping: true });
});

// Edit one chapter's upload info before rendering/uploading.
youtubeRouter.patch("/stories/:id/youtube/:order", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: t("Invalid chapter order") });
    return;
  }
  const record = await library.stories.getYouTubeVideo(story.id, order);
  if (!record) {
    res.status(404).json({ message: t("No upload info for this chapter yet") });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, string | number | undefined> = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      res.status(400).json({ message: t("The title cannot be empty") });
      return;
    }
    const title = sanitizeYouTubeText(body.title.trim()).slice(0, 100);
    if (!title) {
      res.status(400).json({ message: t("The title cannot be empty") });
      return;
    }
    patch.title = title;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      res.status(400).json({ message: t("description must be text") });
      return;
    }
    patch.description = sanitizeYouTubeText(body.description).slice(0, 5000);
  }
  if (body.tags !== undefined) {
    if (typeof body.tags !== "string") {
      res.status(400).json({ message: t("tags must be text") });
      return;
    }
    patch.tags = sanitizeYouTubeText(body.tags).slice(0, 500);
  }
  if (body.publishAt !== undefined) {
    if (body.publishAt === null || body.publishAt === "") patch.publishAt = undefined;
    else if (typeof body.publishAt === "string") patch.publishAt = body.publishAt.trim().slice(0, 40);
    else {
      res.status(400).json({ message: t("publishAt must be an ISO 8601 time") });
      return;
    }
  }
  if (body.musicId !== undefined) {
    if (typeof body.musicId !== "string") {
      res.status(400).json({ message: t("musicId must be text") });
      return;
    }
    if (body.musicId && !(await backgroundMusic.get(body.musicId))) {
      res.status(400).json({ message: t("Background music track not found") });
      return;
    }
    patch.musicId = body.musicId || undefined;
  }
  if (body.musicVolume !== undefined) {
    const volume = Number(body.musicVolume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 4) {
      res.status(400).json({ message: t("musicVolume must be a number between 0 and 4") });
      return;
    }
    patch.musicVolume = volume;
  }
  const next = { ...record, ...patch, updatedAt: new Date().toISOString() };
  await library.stories.saveYouTubeVideo({ ...next, storyId: story.id });
  res.json({ record: next });
});

// The rendered MP4, for the panel's preview player.
youtubeRouter.get("/stories/:id/youtube/:order/video", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: t("Invalid chapter order") });
    return;
  }
  const record = await library.stories.getYouTubeVideo(story.id, order);
  const file = record ? resolveVideoPath(library.dataDir, story.id, record) : undefined;
  if (!file || !(await fs.stat(file).catch(() => undefined))) {
    res.status(404).json({ message: t("No video for this chapter yet") });
    return;
  }
  res.type("video/mp4");
  res.sendFile(file);
});

// Drop a chapter's draft record and its rendered file. Videos already on YouTube are not
// touched — they have to be deleted in YouTube Studio.
youtubeRouter.delete("/stories/:id/youtube/:order", async (req, res) => {
  const library = guardJob(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const order = Number(req.params.order);
  if (!Number.isInteger(order)) {
    res.status(400).json({ message: t("Invalid chapter order") });
    return;
  }
  const record = await library.stories.getYouTubeVideo(story.id, order);
  if (!record) {
    res.status(404).json({ message: t("No upload info for this chapter yet") });
    return;
  }
  if (record.status === "uploading") {
    res.status(409).json({ message: t("A YouTube job is already running for this story") });
    return;
  }
  // Dropping a local record never touches YouTube; an uploaded video stays on the channel.
  const file = resolveVideoPath(library.dataDir, story.id, record);
  if (file) await fs.rm(file, { force: true });
  await library.stories.removeYouTubeVideo(story.id, order);
  res.json({ ok: true });
});
