import { en } from "./en";
import { vi } from "./vi";

/**
 * Language registry: one file per language under locales/, one entry here. The
 * Lang type, the language button and the parity test all read from this, so
 * adding a language means adding its file plus this one line.
 *
 * `label` is the language's own name (autonym), never translated.
 */
export const LOCALES = {
  vi: { label: "Tiếng Việt", messages: vi },
  en: { label: "English", messages: en },
} as const;

export type Lang = keyof typeof LOCALES;

// Vietnamese by default: the sites this tool crawls are Vietnamese, and so is
// almost everyone reading from it.
export const DEFAULT_LANG: Lang = "vi";

export const LANGUAGES: { code: Lang; label: string }[] = Object.entries(LOCALES).map(
  ([code, locale]) => ({ code: code as Lang, label: locale.label })
);
