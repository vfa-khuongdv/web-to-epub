import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Router } from "express";
import { contentDisposition, fileStem } from "../services/epubBuilder";
import { t } from "../services/lang";
import { settingsStore } from "../services/settingsStore";
import { readFreshAudio } from "../services/tts/audioCache";
import { AudioZipEntry, chapterAudioFileName, writeAudioZip } from "../services/tts/audioExport";
import { chapterKey, chaptersToNarrate } from "../services/tts/narrate";
import { StoryStore } from "../services/storyStore";
import { libraryFor } from "./library";

export const audioExportsRouter = Router();

// A finished zip waits on disk (not in RAM like an EPUB: a story's narration runs to
// gigabytes) until the browser fetches it, then is deleted.
const AUDIO_EXPORT_TTL_MS = 30 * 60_000;
const pendingAudioExports = new Map<string, { filePath: string; fileName: string }>();

const narrationSettings = () => {
  const { ttsVariant, ttsVoice } = settingsStore.get();
  return { variant: ttsVariant, voice: ttsVoice };
};

// The audio file of one chapter, if it matches the chapter's current text and voice.
async function freshChapterAudio(stories: StoryStore, dataDir: string, storyId: string, order: number) {
  const chapter = await stories.getChapter(storyId, order);
  if (!chapter || chapter.status !== "done") return undefined;
  const key = chapterKey(chapter, narrationSettings());
  const audio = key ? await readFreshAudio(dataDir, storyId, order, key) : undefined;
  return audio ? { ...audio, title: chapter.title } : undefined;
}

// Opened by an <a href> / <audio src>, which cannot send headers: the private-mode token
// comes as ?vault=, which libraryFor already accepts.
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
  const { size } = await fs.stat(audio.filePath);
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Content-Length": size,
    "Content-Disposition": contentDisposition(chapterAudioFileName(order, audio.title, 3)),
  });
  createReadStream(audio.filePath).pipe(res);
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
  const exportId = randomUUID();
  const fileName = `${fileStem(story.title, "book")} (audio).zip`;
  pendingAudioExports.set(exportId, { filePath, fileName });
  setTimeout(() => {
    if (pendingAudioExports.delete(exportId)) void fs.rm(filePath, { force: true });
  }, AUDIO_EXPORT_TTL_MS).unref();

  res.json({ exportId, fileName, count: entries.length, missing });
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
    "Content-Type": "application/zip",
    "Content-Length": size,
    "Content-Disposition": contentDisposition(pending.fileName),
  });
  const stream = createReadStream(pending.filePath);
  const cleanup = () => void fs.rm(pending.filePath, { force: true });
  stream.on("close", cleanup);
  stream.pipe(res);
});
