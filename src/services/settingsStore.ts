/**
 * App settings: the handful of preferences that belong to the installation rather
 * than to one story or one browser.
 *
 * They live in a `settings` table in the normal library's stories.db and are NOT
 * per-library: private mode is a different shelf, not a different app, and a reader
 * who turns off the launch check expects it off on both.
 *
 * Reads are synchronous (like services/vault.ts) because they are: the store is asked
 * for defaults in the middle of adding a story.
 */
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "../config/paths";
import { TTS_VARIANTS, TtsVariant } from "./tts/workerClient";

export interface AppSettings {
  // Check watched stories for new chapters when the app opens. Off means the library
  // only checks when the reader asks for it.
  autoScanOnOpen: boolean;
  // Filled into a story the first time it is added; the story's own "Save info" wins
  // from then on.
  defaultBookLanguage: string;
  defaultAuthor: string;
  // Narration: which VieNeu model reads ("turbo" = quality, "nano" = fast) and which of
  // its preset voices; "" means the model's own default voice.
  ttsVariant: TtsVariant;
  ttsVoice: string;
  // A sentence introducing the channel is read before a story's first chapter. The text may
  // use {channel} and {title}; empty means the built-in wording (services/tts/intro.ts).
  narrationIntro: boolean;
  narrationIntroText: string;
}

export const MAX_TTS_VOICE = 100;

// The languages epubBuilder writes into the book, and the two the story form offers.
export const BOOK_LANGUAGES = ["vi", "en"] as const;

export const MAX_DEFAULT_AUTHOR = 200;

// autoScanOnOpen defaults to true: that is what the app did before there was a setting.
export const DEFAULT_SETTINGS: AppSettings = {
  autoScanOnOpen: true,
  defaultBookLanguage: "vi",
  defaultAuthor: "",
  ttsVariant: "turbo",
  ttsVoice: "",
  narrationIntro: true,
  narrationIntroText: "",
};

export interface SettingsStore {
  get(): AppSettings;
  // Only the keys present are written; the rest keep their saved value.
  update(patch: Partial<AppSettings>): AppSettings;
  // Free-form value kept under its own key, for settings that are a structure (AI
  // providers) rather than one of the typed fields above.
  getRaw(key: string): string | undefined;
  setRaw(key: string, value: string): void;
}

export function createSettingsStore(baseDir: string): SettingsStore {
  fs.mkdirSync(baseDir, { recursive: true });
  const db = new DatabaseSync(path.join(baseDir, "stories.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const selectAll = db.prepare(`SELECT key, value FROM settings`);
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  function saved(key: string): string | undefined {
    const rows = selectAll.all() as unknown as { key: string; value: string }[];
    return rows.find((row) => row.key === key)?.value;
  }

  function get(): AppSettings {
    const rows = selectAll.all() as unknown as { key: string; value: string }[];
    const saved = new Map(rows.map((row) => [row.key, row.value]));
    const autoScan = saved.get("autoScanOnOpen");
    return {
      autoScanOnOpen: autoScan === undefined ? DEFAULT_SETTINGS.autoScanOnOpen : autoScan === "1",
      defaultBookLanguage: saved.get("defaultBookLanguage") ?? DEFAULT_SETTINGS.defaultBookLanguage,
      defaultAuthor: saved.get("defaultAuthor") ?? DEFAULT_SETTINGS.defaultAuthor,
      ttsVariant: TTS_VARIANTS.includes(saved.get("ttsVariant") as TtsVariant)
        ? (saved.get("ttsVariant") as TtsVariant)
        : DEFAULT_SETTINGS.ttsVariant,
      ttsVoice: saved.get("ttsVoice") ?? DEFAULT_SETTINGS.ttsVoice,
      narrationIntro: saved.get("narrationIntro") === undefined ? DEFAULT_SETTINGS.narrationIntro : saved.get("narrationIntro") === "1",
      narrationIntroText: saved.get("narrationIntroText") ?? DEFAULT_SETTINGS.narrationIntroText,
    };
  }

  return {
    get,

    getRaw(key: string): string | undefined {
      return saved(key);
    },

    setRaw(key: string, value: string): void {
      upsert.run(key, value);
    },

    update(patch: Partial<AppSettings>): AppSettings {
      if (patch.autoScanOnOpen !== undefined) upsert.run("autoScanOnOpen", patch.autoScanOnOpen ? "1" : "0");
      if (patch.defaultBookLanguage !== undefined) upsert.run("defaultBookLanguage", patch.defaultBookLanguage);
      if (patch.defaultAuthor !== undefined) upsert.run("defaultAuthor", patch.defaultAuthor);
      if (patch.ttsVariant !== undefined) upsert.run("ttsVariant", patch.ttsVariant);
      if (patch.ttsVoice !== undefined) upsert.run("ttsVoice", patch.ttsVoice);
      if (patch.narrationIntro !== undefined) upsert.run("narrationIntro", patch.narrationIntro ? "1" : "0");
      if (patch.narrationIntroText !== undefined) upsert.run("narrationIntroText", patch.narrationIntroText);
      return get();
    },
  };
}

export const settingsStore = createSettingsStore(DATA_DIR);
