import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { vi } from "./messages";

export type Lang = "vi" | "en";

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "vi", label: "Tiếng Việt" },
  { code: "en", label: "English" },
];

const LANG_KEY = "lang";

// Vietnamese by default: the sites this tool crawls are Vietnamese, and so is
// almost everyone reading from it.
const DEFAULT_LANG: Lang = "vi";

// localStorage can throw (private window, cookies blocked): the language still
// switches, it just won't be remembered — same handling as the theme switch.
function readLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "en" ? "en" : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

/**
 * Keys are the English text itself, not invented identifiers: a string with no
 * entry in the dictionary falls back to readable English instead of a blank or a
 * bare key, and the source stays legible at the call site.
 */
export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const text = (lang === "vi" ? vi[key] : undefined) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole));
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

interface LangValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const LangContext = createContext<LangValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key) => translate(DEFAULT_LANG, key),
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(readLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* Not remembered next time, the app still runs in the chosen language */
    }
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t: (key, params) => translate(lang, key, params) }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangValue {
  return useContext(LangContext);
}

// api.ts is not a component and cannot read the context, but it has to tell the
// server which language to phrase its errors in; localStorage is the same source
// the provider writes to.
export const currentLang = readLang;
