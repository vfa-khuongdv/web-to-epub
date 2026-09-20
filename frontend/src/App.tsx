import { useEffect, useState } from "react";
import LibraryView from "./components/LibraryView";
import ManualCrawlView from "./components/ManualCrawlView";
import { JobStrip } from "./components/JobStrip";
import { Icon, IconName } from "./components/Icon";
import { fetchSupportedSites } from "./api";
import { Lang, LANGUAGES, useLang } from "./i18n";
import { SupportedSite } from "./types";
import { useCrawlJob } from "./useCrawlJob";
import { useVault } from "./vault";

type Theme = "system" | "light" | "dark";

const THEME_KEY = "theme";
// Click button to cycle: auto -> light -> dark -> auto.
const THEME_CYCLE: Theme[] = ["system", "light", "dark"];
const THEME_LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };
const THEME_ICON: Record<Theme, IconName> = { system: "display", light: "sun", dark: "moon" };

// localStorage can throw (private window, cookies blocked): theme still switches, just
// won't be remembered on next open.
function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme): void {
  const dark = theme === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export default function App() {
  const [supportedSites, setSupportedSites] = useState<SupportedSite[]>([]);
  const [tab, setTab] = useState<"library" | "manual">("library");
  const [theme, setTheme] = useState<Theme>(readTheme);
  const { lang, setLang, t } = useLang();
  const vault = useVault();
  const { job, live, run, attach, subscribe, clearChapters } = useCrawlJob();
  const nextTheme = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
  // Only two languages, so the button swaps between them rather than opening a menu.
  const nextLang: Lang = lang === "vi" ? "en" : "vi";
  const langLabel = (code: Lang) => LANGUAGES.find((l) => l.code === code)!.label;

  useEffect(() => {
    fetchSupportedSites().then(setSupportedSites).catch(() => setSupportedSites([]));
  }, []);

  // Shared live channel: open once for the whole app, close on unmount.
  useEffect(() => subscribe(), [subscribe]);

  useEffect(() => {
    applyTheme(theme);
    try {
      if (theme === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* Storage failed, but theme still changes for this session */
    }
    if (theme !== "system") return;
    // Auto mode: switch immediately when OS changes light/dark preference.
    const media = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme("system");
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

  const themeTitle =
    (theme === "system"
      ? t("Theme: {theme} (system)", { theme: t(THEME_LABEL[theme]) })
      : t("Theme: {theme}", { theme: t(THEME_LABEL[theme]) })) +
    " — " +
    t("Click to switch to {theme}", { theme: t(THEME_LABEL[nextTheme]) });

  return (
    <div className="app">
      <header className="cmdbar">
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-sm font-semibold tracking-[-0.01em]">Web → EPUB</span>
          <small className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-2">
            {t("for Kindle")}
          </small>
        </span>

        <nav className="tabs" role="tablist" aria-label={t("Workspace")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "library"}
            onClick={() => setTab("library")}
          >
            <Icon name="library" size={14} />
            {t("My Stories")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "manual"}
            onClick={() => setTab("manual")}
          >
            <Icon name="crawl" size={14} />
            {t("Manual Crawl")}
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-3 text-xs text-ink-2">
          {/* The only trace of private mode in the UI, and only while it is open — it
              doubles as the way out for anyone who did not use the shortcut. */}
          {vault.active && (
            <button
              type="button"
              className="chip chip-private"
              title={t("Private mode — click to leave")}
              onClick={vault.leave}
            >
              <Icon name="lock" size={12} />
              {t("Private")}
            </button>
          )}

          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            title={`${t("Language: {language}", { language: langLabel(lang) })} — ${t(
              "Click to switch to {language}",
              { language: langLabel(nextLang) }
            )}`}
            aria-label={`${t("Language: {language}", { language: langLabel(lang) })}. ${t(
              "Click to switch to {language}",
              { language: langLabel(nextLang) }
            )}`}
            onClick={() => setLang(nextLang)}
          >
            <Icon name="language" size={14} />
            <span className="uppercase">{lang}</span>
          </button>

          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            title={themeTitle}
            aria-label={`${
              theme === "system"
                ? t("Theme: {theme} (system)", { theme: t(THEME_LABEL[theme]) })
                : t("Theme: {theme}", { theme: t(THEME_LABEL[theme]) })
            }. ${t("Click to switch to {theme}", { theme: t(THEME_LABEL[nextTheme]) })}`}
            onClick={() => setTheme(nextTheme)}
          >
            <Icon name={THEME_ICON[theme]} size={14} />
          </button>

          {job.running ? (
            <span className="chip chip-running">
              <Icon name="dot" size={12} className="animate-pulse" />
              {job.total > 0 ? t("Crawling {done}/{total}", { done: job.cursor, total: job.total }) : t("Crawling")}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Icon name="info" size={13} className="text-ink-3" />
              {supportedSites.length > 0
                ? t("{count} sites supported", { count: supportedSites.length })
                : t("Loading supported sites…")}
            </span>
          )}
        </div>
      </header>

      <div className="workbench">
        {tab === "library" ? (
          <LibraryView job={job} live={live} attach={attach} clearChapters={clearChapters} supportedSites={supportedSites} />
        ) : (
          <ManualCrawlView run={run} job={job} clearChapters={clearChapters} supportedSites={supportedSites} />
        )}
      </div>

      <JobStrip job={job} />
    </div>
  );
}
