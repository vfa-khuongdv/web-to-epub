import { Router } from "express";
import { APP_VERSION } from "../config/appInfo";
import { t } from "../services/lang";
import {
  AppSettings,
  BOOK_LANGUAGES,
  MAX_DEFAULT_AUTHOR,
  MAX_TTS_VOICE,
  settingsStore,
} from "../services/settingsStore";
import { TTS_VARIANTS, TtsVariant } from "../services/tts/workerClient";
import { vault } from "../services/vault";
import { libraryFor } from "./library";

export const settingsRouter = Router();

// The settings page asks for both halves in one go: the values it can change, and the
// read-only facts about this installation it shows next to them. The counts and the
// directory describe the library actually open, so private mode reports its own.
settingsRouter.get("/settings", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const stories = await library.stories.list();
  res.json({
    settings: settingsStore.get(),
    app: {
      version: APP_VERSION,
      dataDir: library.dataDir,
      storyCount: stories.length,
      chapterCount: stories.reduce((total, story) => total + story.chapterCount, 0),
      privateConfigured: vault.isConfigured(),
    },
  });
});

settingsRouter.patch("/settings", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Partial<AppSettings> = {};

  if ("autoScanOnOpen" in body) {
    if (typeof body.autoScanOnOpen !== "boolean") {
      res.status(400).json({ message: t("autoScanOnOpen must be true or false") });
      return;
    }
    patch.autoScanOnOpen = body.autoScanOnOpen;
  }

  if ("defaultBookLanguage" in body) {
    if (!BOOK_LANGUAGES.includes(body.defaultBookLanguage as (typeof BOOK_LANGUAGES)[number])) {
      res.status(400).json({ message: t("Unsupported book language") });
      return;
    }
    patch.defaultBookLanguage = body.defaultBookLanguage as string;
  }

  if ("defaultAuthor" in body) {
    if (typeof body.defaultAuthor !== "string" || body.defaultAuthor.trim().length > MAX_DEFAULT_AUTHOR) {
      res.status(400).json({ message: t("Default author is too long") });
      return;
    }
    patch.defaultAuthor = body.defaultAuthor.trim();
  }

  if ("ttsVariant" in body) {
    if (!TTS_VARIANTS.includes(body.ttsVariant as TtsVariant)) {
      res.status(400).json({ message: t("Unsupported narration variant") });
      return;
    }
    patch.ttsVariant = body.ttsVariant as TtsVariant;
  }

  if ("ttsVoice" in body) {
    if (typeof body.ttsVoice !== "string" || body.ttsVoice.length > MAX_TTS_VOICE) {
      res.status(400).json({ message: t("Voice name is too long") });
      return;
    }
    patch.ttsVoice = body.ttsVoice;
  }

  res.json({ settings: settingsStore.update(patch) });
});
