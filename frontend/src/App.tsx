import { useEffect, useState } from "react";
import LibraryView from "./components/LibraryView";
import { JobStrip } from "./components/JobStrip";
import { NoticeStack } from "./components/NoticeStack";
import { Icon, IconName } from "./components/Icon";
import { fetchSupportedSites } from "./lib/api";
import { Lang, LANGUAGES, useLang } from "./i18n";
import { SupportedSite } from "./types";
import { useCrawlJob } from "./hooks/useCrawlJob";
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
  const [sitesOpen, setSitesOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const { lang, setLang, t } = useLang();
  const vault = useVault();
  const { job, live, attach, subscribe, clearChapters, notices, dismissNotice, pushNotice } = useCrawlJob();
  const nextTheme = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
  // Only two languages, so the button swaps between them rather than opening a menu.
  const nextLang: Lang = lang === "vi" ? "en" : "vi";
  const langLabel = (code: Lang) => LANGUAGES.find((l) => l.code === code)!.label;

  useEffect(() => {
    fetchSupportedSites().then(setSupportedSites).catch(() => setSupportedSites([]));
  }, []);

  // Shared live channel: open once for the whole app, close on unmount.
  useEffect(() => subscribe(), [subscribe]);

  // The supported-sites popover closes on Escape; clicking outside is handled by
  // its own backdrop (see below).
  useEffect(() => {
    if (!sitesOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSitesOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sitesOpen]);

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
            // Help: the count alone doesn't say *which* sites are accepted, and that
            // is the first thing someone with a URL in hand wants to know.
            <span className="relative flex items-center">
              <button
                type="button"
                className="btn btn-quiet btn-tiny"
                aria-expanded={sitesOpen}
                aria-controls="supported-sites"
                disabled={supportedSites.length === 0}
                title={t("Click to view the supported sites")}
                onClick={() => setSitesOpen((open) => !open)}
              >
                <Icon name="info" size={13} className="text-ink-3" />
                {supportedSites.length > 0
                  ? t("{count} sites supported", { count: supportedSites.length })
                  : t("Loading supported sites…")}
              </button>
              {sitesOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-20 cursor-default"
                    aria-label={t("Close")}
                    onClick={() => setSitesOpen(false)}
                  />
                  <div
                    id="supported-sites"
                    className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-tool border border-rule-2 bg-raised p-2.5 text-left shadow-lg"
                  >
                    <h3 className="mb-1.5 text-[10.5px] font-[650] tracking-[0.07em] uppercase text-ink-2">
                      {t("Supported sites")}
                    </h3>
                    <ul>
                      {supportedSites.map((site) => (
                        <li key={site.domain} className="py-0.5 text-[12.5px] whitespace-nowrap">
                          {/* Opens in a new tab: the reader keeps the library they
                              were about to paste a URL from. */}
                          <a
                            href={`https://${site.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="group flex items-baseline justify-between gap-2.5 text-inherit no-underline hover:text-select hover:underline"
                            onClick={() => setSitesOpen(false)}
                          >
                            <span>{site.name}</span>
                            <span className="text-ink-3 group-hover:text-inherit">{site.domain}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </span>
          )}
        </div>
      </header>

      <div className="workbench">
        <LibraryView
          job={job}
          live={live}
          attach={attach}
          clearChapters={clearChapters}
          supportedSites={supportedSites}
          pushNotice={pushNotice}
        />
      </div>

      <JobStrip job={job} />
      <NoticeStack notices={notices} onDismiss={dismissNotice} />
    </div>
  );
}
