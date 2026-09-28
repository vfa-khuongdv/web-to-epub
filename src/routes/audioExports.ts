import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Router } from "express";
import { MIX_SCRIPT } from "../config/tts";
import { backgroundMusic } from "../services/backgroundMusic";
import { contentDisposition, fileStem } from "../services/epubBuilder";
import { t } from "../services/lang";
import { settingsStore } from "../services/settingsStore";
import { AudioZipEntry, chapterAudioFileName, writeAudioZip } from "../services/tts/audioExport";
import { chaptersToNarrate, freshChapterAudio as freshAudio } from "../services/tts/narrate";
import { runtimeFor } from "../services/tts/runtime";
import { mixStoryAudio } from "../services/tts/storyMix";
import { TtsVariant } from "../services/tts/workerClient";
import { libraryFor } from "./library";

export const audioExportsRouter = Router();

// A finished zip waits on disk (not in RAM like an EPUB: a story's narration runs to
// gigabytes) until the browser fetches it, then is deleted.
const AUDIO_EXPORT_TTL_MS = 30 * 60_000;
const pendingAudioExports = new Map<string, { filePath: string; fileName: string; contentType: string }>();

function holdExport(filePath: string, fileName: string, contentType: string): string {
  const exportId = randomUUID();
  pendingAudioExports.set(exportId, { filePath, fileName, contentType });
  setTimeout(() => {
    if (pendingAudioExports.delete(exportId)) void fs.rm(filePath, { force: true });
  }, AUDIO_EXPORT_TTL_MS).unref();
  return exportId;
}

const MAX_MUSIC_GAIN = 4;

// "Export audio (1 file)" runs for minutes on a long story — longer than an HTTP request
// may stay open — so it is a job the page polls. Kept in memory: single process only.
interface MixJob {
  storyId: string;
  state: "running" | "done" | "error";
  done: number;
  total: number;
  exportId?: string;
  fileName?: string;
  message?: string;
  // The track mixed in, so the page can say which one.
  musicName?: string;
}
const mixJobs = new Map<string, MixJob>();

const narrationSettings = () => {
  const { ttsVariant, ttsVoice } = settingsStore.get();
  return { variant: ttsVariant, voice: ttsVoice };
};

const freshChapterAudio = (stories: Parameters<typeof freshAudio>[0], dataDir: string, storyId: string, order: number) =>
  freshAudio(stories, dataDir, storyId, order, narrationSettings());

// Opened by an <a href> / <audio src>, which cannot send headers: the private-mode token
// comes as ?vault=, which libraryFor already accepts. Served with sendFile so the player
// can seek (HTTP Range); `?download=1` adds the attachment name for the download link.
audioExportsRouter.get("/stories/:id/chapters/:order/audio", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const order = Number(req.params.order);
  const audio = Number.isInteger(order)
    ? await freshChapterAudio(library.stories, library.dataDir, req.params.id, order)
    : undefined;
  if (!audio) {
    res.status(409).json({ message: t("Chapter audio has not been generated yet — narrate the chapter first") });
    return;
  }
  const headers: Record<string, string> = { "Content-Type": "audio/mpeg", "Cache-Control": "no-cache" };
  if (req.query.download === "1") headers["Content-Disposition"] = contentDisposition(chapterAudioFileName(order, audio.title, 3));
  res.sendFile(audio.filePath, { headers });
});

// Zip every narrated chapter (or the requested ones) whose audio is current. Chapters
// without current audio are left out and listed, so the page can say what is missing.
audioExportsRouter.post("/stories/:id/export-audio", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const body = (req.body ?? {}) as { orders?: unknown };
  const orders = Array.isArray(body.orders) ? body.orders.filter((o): o is number => Number.isInteger(o)) : undefined;
  const plan = await chaptersToNarrate(library.stories, story.id, orders);
  const width = String(Math.max(0, ...plan)).length;

  const entries: AudioZipEntry[] = [];
  const missing: number[] = [];
  for (const order of plan) {
    const audio = await freshChapterAudio(library.stories, library.dataDir, story.id, order);
    if (audio) entries.push({ name: chapterAudioFileName(order, audio.title, width), filePath: audio.filePath });
    else missing.push(order);
  }
  if (entries.length === 0) {
    res.status(400).json({ message: t("No narrated chapters to export") });
    return;
  }

  const filePath = path.join(os.tmpdir(), `audio-export-${randomUUID()}.zip`);
  try {
    await writeAudioZip(entries, filePath);
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    return;
  }
  const fileName = `${fileStem(story.title, "book")} (audio).zip`;
  const exportId = holdExport(filePath, fileName, "application/zip");

  res.json({ exportId, fileName, count: entries.length, missing });
});

// The Python of whichever engine is installed — the one in Settings first. The mixer only
// needs numpy/soundfile/soxr, which both carry.
async function mixerPython(): Promise<{ command: string; env: NodeJS.ProcessEnv } | undefined> {
  const variants: TtsVariant[] = [settingsStore.get().ttsVariant, "turbo", "omnivoice"];
  for (const variant of variants) {
    const python = await runtimeFor(variant).python();
    if (python) return python;
  }
  return undefined;
}

// One MP3 of the whole story with the player's background music under it. Only once
// every chapter has audio: a book-length file with holes in it is not worth hours of
// listening. Answers 202 with a job id; GET /exports/audio-mix/:jobId reports progress.
audioExportsRouter.post("/stories/:id/export-audio-mix", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const running = [...mixJobs.values()].some((job) => job.storyId === story.id && job.state === "running");
  if (running) {
    res.status(409).json({ message: t("This story's audio is already being joined") });
    return;
  }

  const plan = await chaptersToNarrate(library.stories, story.id);
  const chapters: string[] = [];
  const missing: number[] = [];
  for (const order of plan) {
    const audio = await freshChapterAudio(library.stories, library.dataDir, story.id, order);
    if (audio) chapters.push(audio.filePath);
    else missing.push(order);
  }
  if (chapters.length === 0) {
    res.status(400).json({ message: t("No narrated chapters to export") });
    return;
  }
  if (missing.length > 0) {
    res.status(400).json({
      message: t("Every chapter needs audio before the story can be joined into one file — {count} chapters have none yet", {
        count: missing.length,
      }),
      missing,
    });
    return;
  }

  const body = (req.body ?? {}) as { musicId?: unknown; musicVolume?: unknown };
  let music: string | undefined;
  let musicName: string | undefined;
  if (typeof body.musicId === "string") {
    const track = await backgroundMusic.get(body.musicId);
    if (!track) {
      res.status(400).json({ message: t("Background music track not found") });
      return;
    }
    music = backgroundMusic.filePath(track);
    musicName = track.name;
  }
  // The music's gain against the voice at full volume. The page sends the player's music
  // volume over its voice volume, so the file keeps the balance heard in the app — above
  // 1 when the voice is turned down, capped so music cannot bury the narration.
  const musicVolume =
    typeof body.musicVolume === "number" && body.musicVolume >= 0 ? Math.min(body.musicVolume, MAX_MUSIC_GAIN) : 0.3;

  const python = await mixerPython();
  if (!python) {
    res.status(409).json({ message: t("Narration is not installed — install it in Settings → Narration") });
    return;
  }

  const jobId = randomUUID();
  const job: MixJob = { storyId: story.id, state: "running", done: 0, total: chapters.length, musicName };
  mixJobs.set(jobId, job);
  setTimeout(() => mixJobs.delete(jobId), AUDIO_EXPORT_TTL_MS * 4).unref();
  res.status(202).json({ jobId, total: chapters.length });

  const filePath = path.join(os.tmpdir(), `audio-export-${randomUUID()}.mp3`);
  try {
    await mixStoryAudio(
      { command: python.command, args: [MIX_SCRIPT], env: python.env },
      { chapters, music, musicVolume, out: filePath },
      (done) => {
        job.done = done;
      }
    );
    job.fileName = `${fileStem(story.title, "book")} (audio).mp3`;
    job.exportId = holdExport(filePath, job.fileName, "audio/mpeg");
    job.state = "done";
  } catch (err) {
    await fs.rm(filePath, { force: true });
    job.state = "error";
    job.message = err instanceof Error ? err.message : String(err);
  }
});

// Progress of a join. The id is a random UUID handed only to the page that asked.
audioExportsRouter.get("/exports/audio-mix/:jobId", (req, res) => {
  const job = mixJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ message: t("Export has expired or already been downloaded — click Export EPUB again") });
    return;
  }
  const { storyId: _storyId, ...status } = job;
  res.json(status);
});

// Download once, then delete — like /exports/:exportId for EPUBs. The id is a random
// UUID handed only to the page that asked, so this needs no library token.
audioExportsRouter.get("/exports/audio/:exportId", async (req, res) => {
  const pending = pendingAudioExports.get(req.params.exportId);
  if (!pending) {
    res.status(404).json({ message: t("Export has expired or already been downloaded — click Export EPUB again") });
    return;
  }
  pendingAudioExports.delete(req.params.exportId);
  const { size } = await fs.stat(pending.filePath);
  res.writeHead(200, {
    "Content-Type": pending.contentType,
    "Content-Length": size,
    "Content-Disposition": contentDisposition(pending.fileName),
  });
  const stream = createReadStream(pending.filePath);
  const cleanup = () => void fs.rm(pending.filePath, { force: true });
  stream.on("close", cleanup);
  stream.pipe(res);
});
