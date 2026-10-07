import fs from "fs/promises";
import path from "path";
import express from "express";
import { createRouter } from "./asyncRouter";
import { t } from "../services/lang";
import { settingsStore } from "../services/settingsStore";
import { CUSTOM_VOICE_PREFIX, MAX_VOICE_BYTES, customVoices } from "../services/tts/customVoices";
import { TTS_ENGINES, TtsEngine, engineOf, runtimeFor, ttsEngines, ttsRuntimes } from "../services/tts/runtime";
import { BUILTIN_VOICE_PREFIX, PREVIEW_TEXT, voiceCatalog } from "../services/tts/voiceCatalog";
import { TTS_VARIANTS, TtsVariant, TtsVoice } from "../services/tts/workerClient";

export const ttsRouter = createRouter();

// `?engine=` picks the install the settings page is showing; without it, the engine that
// reads with the current settings (what a story page asks about).
function engineFrom(value: unknown): TtsEngine | undefined {
  if (value === undefined) return engineOf(settingsStore.get().ttsVariant);
  return TTS_ENGINES.includes(value as TtsEngine) ? (value as TtsEngine) : undefined;
}

function variantFrom(value: unknown): TtsVariant | undefined {
  if (value === undefined) return settingsStore.get().ttsVariant;
  return TTS_VARIANTS.includes(value as TtsVariant) ? (value as TtsVariant) : undefined;
}

// Walking ~1 GB of Python packages takes a moment, so the size is only computed when the
// settings page asks for it (once, on open), not on every progress poll.
ttsRouter.get("/tts/status", async (req, res) => {
  const engine = engineFrom(req.query.engine);
  if (!engine) {
    res.status(400).json({ message: t("Unsupported narration engine") });
    return;
  }
  const runtime = ttsRuntimes[engine];
  const status = await runtime.status();
  const diskBytes = req.query.disk === "1" && status.state === "installed" ? await runtime.diskBytes() : undefined;
  res.json({ ...status, engine, diskBytes });
});

// Install runs for minutes (hundreds of MB of Python packages and a model), well past any
// request: answer 202 and let the settings page poll /tts/status for progress.
ttsRouter.post("/tts/install", async (req, res) => {
  const variant = variantFrom((req.body ?? {}).variant);
  if (!variant) {
    res.status(400).json({ message: t("Unsupported narration variant") });
    return;
  }
  const runtime = runtimeFor(variant);
  if (!(await runtime.status()).supported) {
    res.status(400).json({ message: t("Narration is not supported on this platform") });
    return;
  }
  runtime.install(variant).catch(() => {
    /* reported through /tts/status */
  });
  res.status(202).json({ ...(await runtime.status()), engine: engineOf(variant) });
});

ttsRouter.delete("/tts", async (req, res) => {
  const engine = engineFrom(req.query.engine);
  if (!engine) {
    res.status(400).json({ message: t("Unsupported narration engine") });
    return;
  }
  try {
    await ttsRuntimes[engine].uninstall();
    res.json({ ...(await ttsRuntimes[engine].status()), engine });
  } catch (err) {
    res.status(409).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

async function requireInstalled(variant: TtsVariant, res: import("express").Response): Promise<boolean> {
  if ((await runtimeFor(variant).status()).state === "installed") return true;
  res.status(409).json({ message: t("Narration is not installed — install it in Settings → Narration") });
  return false;
}

// Listed from the files that ship with the app (see voiceCatalog.ts), so the settings page
// shows them at once and before an engine is installed. Only a VieNeu model the render
// script has not listed is asked for its voices, which loads it.
ttsRouter.get("/tts/voices", async (req, res) => {
  const variant = variantFrom(req.query.variant);
  if (!variant) {
    res.status(400).json({ message: t("Unsupported narration variant") });
    return;
  }
  try {
    let presets: TtsVoice[] | undefined =
      variant === "omnivoice"
        ? (await voiceCatalog.builtins()).map((voice) => ({ id: `${BUILTIN_VOICE_PREFIX}${voice.id}`, label: voice.label }))
        : await voiceCatalog.presets(variant);
    if (!presets) {
      if (!(await requireInstalled(variant, res))) return;
      presets = await ttsEngines.withModel(variant, async (_worker, model) => model.voices);
    }
    // Custom voices work with either model: each one enrolls the clip for itself.
    const custom = (await customVoices.list()).map((voice) => ({
      id: `${CUSTOM_VOICE_PREFIX}${voice.id}`,
      label: voice.name,
      custom: true,
    }));
    res.json({ variant, voices: [...presets, ...custom] });
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

// Plays a sample rendered ahead of time: the one bundled with the app, else the one this
// machine rendered the first time (a custom voice, or a preset newer than the bundle).
// Only that first time needs the engine.
ttsRouter.post("/tts/preview", async (req, res) => {
  const body = (req.body ?? {}) as { variant?: unknown; voice?: unknown };
  const variant = variantFrom(body.variant);
  if (!variant) {
    res.status(400).json({ message: t("Unsupported narration variant") });
    return;
  }
  const voiceId = typeof body.voice === "string" ? body.voice : settingsStore.get().ttsVoice;

  try {
    const voice = await customVoices.synthVoice(voiceId, variant);
    const bundled = await voiceCatalog.bundledSample(variant, voiceId);
    const file =
      bundled ?? voiceCatalog.cachedSamplePath(variant, voiceId, voiceId.startsWith(CUSTOM_VOICE_PREFIX) ? voice.refAudio : undefined);
    const ready =
      bundled !== undefined ||
      (await fs.stat(file).then(
        () => true,
        () => false
      ));
    if (!ready) {
      if (!(await requireInstalled(variant, res))) return;
      await fs.mkdir(path.dirname(file), { recursive: true });
      // The worker writes <out>.part and renames it, so a cut-off render is never served.
      await ttsEngines.withModel(variant, (worker) => worker.synth({ parts: [PREVIEW_TEXT], ...voice, out: file }));
    }
    const bytes = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": bytes.length, "Cache-Control": "no-store" });
    res.end(bytes);
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

// The clip is the request body as is (the file the user picked), its name in `?name=` and
// what is said in it, if the user typed that, in `?transcript=`.
// The parser's limit sits above MAX_VOICE_BYTES so an oversized clip gets our message.
ttsRouter.post(
  "/tts/voices",
  express.raw({ type: () => true, limit: MAX_VOICE_BYTES + 1024 * 1024 }),
  async (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name : "";
    const transcript = typeof req.query.transcript === "string" ? req.query.transcript : "";
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    try {
      const voice = await customVoices.add(name, bytes, transcript);
      res.status(201).json({ id: `${CUSTOM_VOICE_PREFIX}${voice.id}`, label: voice.name, custom: true });
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : String(err) });
    }
  }
);

ttsRouter.delete("/tts/voices/:id", async (req, res) => {
  const id = req.params.id.startsWith(CUSTOM_VOICE_PREFIX) ? req.params.id.slice(CUSTOM_VOICE_PREFIX.length) : req.params.id;
  if (!(await customVoices.remove(id))) {
    res.status(404).json({ message: t("Voice not found") });
    return;
  }
  // A deleted voice must not stay the one new chapters are read with.
  if (settingsStore.get().ttsVoice === `${CUSTOM_VOICE_PREFIX}${id}`) settingsStore.update({ ttsVoice: "" });
  res.status(204).end();
});
