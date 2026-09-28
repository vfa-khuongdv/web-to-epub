import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Response, Router } from "express";
import { MusicTrack, backgroundMusic } from "../services/backgroundMusic";
import { contentDisposition, fileStem } from "../services/epubBuilder";
import { t } from "../services/lang";
import { settingsStore } from "../services/settingsStore";
import { AudioZipEntry, chapterAudioFileName, writeAudioZip } from "../services/tts/audioExport";
import { mixMusic } from "../services/tts/musicMix";
import { chaptersToNarrate, freshChapterAudio as freshAudio } from "../services/tts/narrate";
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

const freshChapterAudio = (stories: Parameters<typeof freshAudio>[0], dataDir: string, storyId: string, order: number) =>
  freshAudio(stories, dataDir, storyId, order, narrationSettings());

// An export can ask for background music mixed under the voice: the track id and its
// volume (0–1, the player's music volume). Answers 404 itself for an unknown track.
async function exportMusic(res: Response, id: unknown, volume: unknown): Promise<{ track: MusicTrack; gain: number } | null | undefined> {
  if (typeof id !== "string" || !id) return null;
  const track = await backgroundMusic.get(id);
  if (!track) {
    res.status(404).json({ message: t("Track not found") });
    return undefined;
  }
  const gain = Number(volume);
  return { track, gain: Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 0.3 };
}

const mixDir = () => fs.mkdtemp(path.join(os.tmpdir(), "audio-mix-"));

// Opened by an <a href> / <audio src>, which cannot send headers: the private-mode token
// comes as ?vault=, which libraryFor already accepts. Served with sendFile so the player
// can seek (HTTP Range); `?download=1` adds the attachment name for the download link, and
// with `&music=<id>&musicVolume=<0–1>` the download has that track mixed under the voice.
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
  if (req.query.download !== "1") {
    res.sendFile(audio.filePath, { headers });
    return;
  }
  headers["Content-Disposition"] = contentDisposition(chapterAudioFileName(order, audio.title, 3));
  const music = await exportMusic(res, req.query.music, req.query.musicVolume);
  if (music === undefined) return;
  if (!music) {
    res.sendFile(audio.filePath, { headers });
    return;
  }
  const dir = await mixDir();
  const mixed = path.join(dir, "mixed.mp3");
  const cleanup = () => void fs.rm(dir, { recursive: true, force: true });
  try {
    await mixMusic(music.track, music.gain, [{ voice: audio.filePath, out: mixed }]);
  } catch (err) {
    cleanup();
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    return;
  }
  res.sendFile(mixed, { headers }, cleanup);
});

// Zip every narrated chapter (or the requested ones) whose audio is current. Chapters
// without current audio are left out and listed, so the page can say what is missing.
// `music: { id, volume }` mixes that track under every chapter first.
audioExportsRouter.post("/stories/:id/export-audio", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const story = await library.stories.getOutline(req.params.id);
  if (!story) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const body = (req.body ?? {}) as { orders?: unknown; music?: { id?: unknown; volume?: unknown } };
  const music = await exportMusic(res, body.music?.id, body.music?.volume);
  if (music === undefined) return;
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
  // Mixed chapters only live until they are in the zip.
  const dir = music ? await mixDir() : undefined;
  try {
    if (music && dir) {
      const mixed = entries.map((entry, i) => ({ ...entry, filePath: path.join(dir, `${i}.mp3`) }));
      await mixMusic(
        music.track,
        music.gain,
        entries.map((entry, i) => ({ voice: entry.filePath, out: mixed[i].filePath }))
      );
      await writeAudioZip(mixed, filePath);
    } else {
      await writeAudioZip(entries, filePath);
    }
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    return;
  } finally {
    if (dir) void fs.rm(dir, { recursive: true, force: true });
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
