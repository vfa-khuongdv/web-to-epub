import express from "express";
import { createRouter } from "./asyncRouter";
import { MAX_MUSIC_BYTES, backgroundMusic, defaultMusicId, musicMime } from "../services/backgroundMusic";
import { t } from "../services/lang";

export const musicRouter = createRouter();

const wire = ({ id, name }: { id: string; name: string }) => ({ id, name });

// `defaultId` is the track the player starts on; it is null when the app ships none, or
// when the user removed that one.
musicRouter.get("/music", async (_req, res) => {
  res.json({ tracks: (await backgroundMusic.list()).map(wire), defaultId: await defaultMusicId(backgroundMusic) });
});

// The file is the request body as is, its name in `?name=`, like a custom voice. The
// parser's limit sits above MAX_MUSIC_BYTES so an oversized file gets our message.
musicRouter.post("/music", express.raw({ type: () => true, limit: MAX_MUSIC_BYTES + 1024 * 1024 }), async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name : "";
  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  try {
    res.status(201).json(wire(await backgroundMusic.add(name, bytes)));
  } catch (err) {
    res.status(400).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

// Opened by an <audio src>; sendFile answers Range requests, which looping relies on.
musicRouter.get("/music/:id/audio", async (req, res) => {
  const track = await backgroundMusic.get(req.params.id);
  if (!track) {
    res.status(404).json({ message: t("Track not found") });
    return;
  }
  res.sendFile(backgroundMusic.filePath(track), { headers: { "Content-Type": musicMime(track.file) } });
});

musicRouter.delete("/music/:id", async (req, res) => {
  if (!(await backgroundMusic.remove(req.params.id))) {
    res.status(404).json({ message: t("Track not found") });
    return;
  }
  res.status(204).end();
});
