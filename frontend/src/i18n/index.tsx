import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { DEFAULT_LANG, LOCALES, Lang } from "./locales";

export type { Lang } from "./locales";
export { LANGUAGES } from "./locales";

const LANG_KEY = "lang";

/**
 * Keys are the English source text itself, not invented identifiers: a string with
 * no entry in the selected language falls back to en.ts (which holds a value for
 * every key) and then to the key, so the UI never shows a raw key name.
 */
export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const text = LOCALES[lang].messages[key] ?? LOCALES.en.messages[key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole));
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

// localStorage can throw (private window, cookies blocked): the language still
// switches, it just won't be remembered — same handling as the theme switch.
function readLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return saved && saved in LOCALES ? (saved as Lang) : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

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
