import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { Router } from "express";
import { t } from "../services/lang";
import { settingsStore } from "../services/settingsStore";
import { ttsRuntime } from "../services/tts/runtime";
import { TTS_VARIANTS, TtsVariant } from "../services/tts/workerClient";

export const ttsRouter = Router();

// A sentence of our own for "Preview": short enough to answer in a few seconds on Nano,
// with a tone mark on most syllables so a voice that mangles them is obvious.
const PREVIEW_TEXT = "Xin chào, đây là giọng đọc thử. Chương một bắt đầu vào một buổi sáng mùa thu.";

function variantFrom(value: unknown): TtsVariant | undefined {
  if (value === undefined) return settingsStore.get().ttsVariant;
  return TTS_VARIANTS.includes(value as TtsVariant) ? (value as TtsVariant) : undefined;
}

// Walking ~1 GB of Python packages takes a moment, so the size is only computed when the
// settings page asks for it (once, on open), not on every progress poll.
ttsRouter.get("/tts/status", async (req, res) => {
  const status = await ttsRuntime.status();
  const diskBytes = req.query.disk === "1" && status.state === "installed" ? await ttsRuntime.diskBytes() : undefined;
  res.json({ ...status, diskBytes });
});

// Install runs for minutes (hundreds of MB of Python packages and a model), well past any
// request: answer 202 and let the settings page poll /tts/status for progress.
ttsRouter.post("/tts/install", async (req, res) => {
  const variant = variantFrom((req.body ?? {}).variant);
  if (!variant) {
    res.status(400).json({ message: t("Unsupported narration variant") });
    return;
  }
  if (!(await ttsRuntime.status()).supported) {
    res.status(400).json({ message: t("Narration is not supported on this platform") });
    return;
  }
  ttsRuntime.install(variant).catch(() => {
    /* reported through /tts/status */
  });
  res.status(202).json(await ttsRuntime.status());
});

ttsRouter.delete("/tts", async (_req, res) => {
  try {
    await ttsRuntime.uninstall();
    res.json(await ttsRuntime.status());
  } catch (err) {
    res.status(409).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

async function requireInstalled(res: import("express").Response): Promise<boolean> {
  if ((await ttsRuntime.status()).state === "installed") return true;
  res.status(409).json({ message: t("Narration is not installed — install it in Settings → Narration") });
  return false;
}

// Voices come from the model itself, so this loads it (seconds for Turbo, the first time).
ttsRouter.get("/tts/voices", async (req, res) => {
  const variant = variantFrom(req.query.variant);
  if (!variant) {
    res.status(400).json({ message: t("Unsupported narration variant") });
    return;
  }
  if (!(await requireInstalled(res))) return;
  try {
    const voices = await ttsRuntime.withModel(variant, async (_worker, model) => model.voices);
    res.json({ variant, voices });
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

ttsRouter.post("/tts/preview", async (req, res) => {
  const body = (req.body ?? {}) as { variant?: unknown; voice?: unknown };
  const variant = variantFrom(body.variant);
  if (!variant) {
    res.status(400).json({ message: t("Unsupported narration variant") });
    return;
  }
  const voice = typeof body.voice === "string" ? body.voice : settingsStore.get().ttsVoice;
  if (!(await requireInstalled(res))) return;

  const out = path.join(os.tmpdir(), `tts-preview-${randomUUID()}.mp3`);
  try {
    await ttsRuntime.withModel(variant, (worker) => worker.synth({ parts: [PREVIEW_TEXT], voice, out }));
    const bytes = await fs.readFile(out);
    res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": bytes.length, "Cache-Control": "no-store" });
    res.end(bytes);
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
  } finally {
    await fs.rm(out, { force: true });
  }
});
