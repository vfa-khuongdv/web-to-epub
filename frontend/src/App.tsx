import { CSSProperties, Suspense, useEffect, useMemo, useRef, useState } from "react";
import LibraryView from "./components/library/LibraryView";
import PlayerBar from "./components/narration/PlayerBar";
import { NarrationPlayerProvider, useNarrationPlayer } from "./hooks/narrationPlayer";
import SettingsOverlay from "./components/settings/SettingsOverlay";
import { AgentActivityButton, AgentActivityDialog } from "./components/library/AgentActivity";
import { CrawlLogButton, CrawlLogDialog } from "./components/library/CrawlLog";
import { NoticeStack } from "./components/ui/NoticeStack";
import { UpdateDialog } from "./components/settings/UpdateDialog";
import { Icon } from "./components/ui/Icon";
import { SplitHandle } from "./components/ui/SplitHandle";
import { readSplit, saveSplit } from "./lib/ui/splitPane";
import { fetchAppUpdate, fetchSettings, fetchSupportedSites } from "./lib/api";
import { Lang, LANGUAGES, useLang } from "./i18n";
import { applyTheme, readTheme, saveTheme, Theme, THEME_CYCLE, THEME_ICON, THEME_LABEL } from "./lib/ui/theme";
import { AppSettings, AppUpdateInfo, SupportedSite } from "./types";
import { useAgentActivity } from "./hooks/useAgentActivity";
import { useCrawlJob } from "./hooks/useCrawlJob";
import { useVault } from "./vault";
import { DocumentHead } from "./lib/ui/skin";
import { SKINS } from "./skins/registry";
import { useSkin } from "./skins/SkinProvider";
import StealthLayer from "./skins/StealthLayer";
import { AppMenu, MenuEntry } from "./skins/AppMenu";
import { useLookEntries, useMenuState } from "./skins/useAppMenu";
import { SkinAppContext } from "./skins/types";

export default function App() {
  const [supportedSites, setSupportedSites] = useState<SupportedSite[]>([]);
  const [sitesOpen, setSitesOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [crawlLogOpen, setCrawlLogOpen] = useState(false);
  const [agentLogOpen, setAgentLogOpen] = useState(false);
  const agent = useAgentActivity();
  const workbench = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(readSplit);
  // Only autoScanOnOpen is needed out here (the library reads it); the settings page
  // loads the rest itself. Undefined until the answer arrives, so the library does not
  // run the launch check against a guess.
  const [autoScan, setAutoScan] = useState<boolean | undefined>();
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const { lang, setLang, t } = useLang();
  const vault = useVault();
  const { job, live, attach, subscribe, clearChapters, notices, dismissNotice, pushNotice } = useCrawlJob();
  const { skin, prefs } = useSkin();
  const definition = SKINS[skin];
  // With a disguise skin chosen, "open in the normal view" shows the app as it always was
  // (to add stories, export, narrate) until the reader goes back; the skin stays chosen.
  const [normalView, setNormalView] = useState<{ storyId: string; order?: number } | true | null>(null);
  // What the skin's tab should say (the open file, the open sheet), set by its shell.
  const [shellHead, setShellHead] = useState<DocumentHead | null>(null);
  // The launch check for new chapters runs once per app open, not on every return to the
  // normal view from a skin (LibraryView forgets that it ran when it unmounts).
  const [launchChecked, setLaunchChecked] = useState(false);
  const Shell = definition.Shell;
  const showShell = !!Shell && normalView === null;
  // The header's look switch: the looks one click away, plus the disguise settings.
  const lookMenu = useMenuState<"look">();
  const looks = useLookEntries();
  const lookEntries: MenuEntry[] = [
    ...looks,
    { kind: "separator", id: "look-sep" },
    { kind: "item", id: "look-settings", label: t("Disguise settings…"), run: () => setSettingsOpen(true) },
  ];

  useEffect(() => {
    setNormalView(null);
    setShellHead(null);
  }, [skin]);

  // Opened in a skin: the launch check for new chapters is skipped (skins show no
  // new-chapter counts), rather than firing the first time the normal view opens.
  useEffect(() => {
    if (showShell) setLaunchChecked(true);
  }, [showShell]);

  const skinApp = useMemo<SkinAppContext>(
    () => ({
      job,
      live,
      attach,
      clearChapters,
      openSettings: () => setSettingsOpen(true),
      openInDefault: (target) => setNormalView(target ?? true),
      neutralNames: prefs.neutralNames,
      isPrivate: vault.active,
      setHead: setShellHead,
    }),
    [job, live, attach, clearChapters, prefs.neutralNames, vault.active]
  );
  const nextTheme = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
  // Only two languages, so the button swaps between them rather than opening a menu.
  const nextLang: Lang = lang === "vi" ? "en" : "vi";
  const langLabel = (code: Lang) => LANGUAGES.find((l) => l.code === code)!.label;

  useEffect(() => {
    fetchSupportedSites().then(setSupportedSites).catch(() => setSupportedSites([]));
    // A server that cannot answer leaves the library doing what it did before there
    // was a setting; the settings page reports the failure if it is opened.
    fetchSettings()
      .then((data) => setAutoScan(data.settings.autoScanOnOpen))
      .catch(() => setAutoScan(true));
  }, []);

  // One update check per app open; failures stay invisible — the server answers
  // "no update" for offline/GitHub errors (services/appUpdate.ts).
  useEffect(() => {
    fetchAppUpdate()
      .then((info) => setUpdateInfo(info.hasUpdate ? info : null))
      .catch(() => setUpdateInfo(null));
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
    saveTheme(theme);
    if (theme !== "system") return;
    // Auto mode: switch immediately when OS changes light/dark preference.
    const media = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme("system");
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

  // Split once here so the popover shows what each kind of domain needs: a chapter list
  // crawled page by page, or a whole book file read in one go.
  const crawlSites = supportedSites.filter((site) => site.mode === "crawl");
  const importSites = supportedSites.filter((site) => site.mode === "import");

  const themeTitle =
    (theme === "system"
      ? t("Theme: {theme} (system)", { theme: t(THEME_LABEL[theme]) })
      : t("Theme: {theme}", { theme: t(THEME_LABEL[theme]) })) +
    " — " +
    t("Click to switch to {theme}", { theme: t(THEME_LABEL[nextTheme]) });

  return (
    // One provider for the skin and the normal view alike: going from one to the other
    // keeps the narration playing.
    <NarrationPlayerProvider keys={!showShell}>
    <StealthLayer definition={definition} head={shellHead} />
    {showShell ? (
      <Suspense fallback={<div className="h-full bg-content" />}>
        <Shell app={skinApp} />
      </Suspense>
    ) : (
    <div className="app">
      <header className="cmdbar">
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-sm font-semibold tracking-[-0.01em]">Web → EPUB</span>
          <small className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-2">
            {t("for Kindle")}
          </small>
        </span>

        <div className="ml-auto flex items-center gap-3 text-xs text-ink-2">
          {/* Back to the disguise this view was opened from. */}
          {Shell && normalView !== null && (
            <button type="button" className="chip" onClick={() => setNormalView(null)}>
              <Icon name="chevron" size={12} className="rotate-180" />
              {t("Back to {skin}", { skin: t(definition.label) })}
            </button>
          )}

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

          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            title={t("Change look")}
            aria-label={t("Change look")}
            aria-haspopup="menu"
            onClick={(event) => lookMenu.open("look", event.currentTarget)}
          >
            <Icon name="disguise" size={14} />
          </button>

          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            title={t("Settings")}
            aria-label={t("Settings")}
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" size={14} />
          </button>

          <AgentActivityButton events={agent.events} busy={agent.busy} onOpen={() => setAgentLogOpen(true)} />
          <CrawlLogButton job={job} onOpen={() => setCrawlLogOpen(true)} />

          {job.running ? null : (
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
                      {crawlSites.map((site) => (
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
                    {importSites.length > 0 && (
                      <>
                        {/* These host whole book files, not chapter pages: the URL is
                            imported instead of crawled. Without the heading, a reader
                            would assume they work the same way. */}
                        <h3 className="mt-2.5 mb-1.5 border-t border-rule-2 pt-2 text-[10.5px] font-[650] tracking-[0.07em] uppercase text-ink-2">
                          {t("Book files (imported)")}
                        </h3>
                        <ul>
                          {importSites.map((site) => (
                            <li key={site.domain} className="py-0.5 text-[12.5px] whitespace-nowrap">
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
                      </>
                    )}
                  </div>
                </>
              )}
            </span>
          )}
        </div>
      </header>

      {updateInfo && !updateDismissed && (
        <UpdateDialog update={updateInfo} onDismiss={() => setUpdateDismissed(true)} />
      )}

      <div
        ref={workbench}
        className="workbench relative"
        style={{ "--left": `${split * 100}fr`, "--right": `${(1 - split) * 100}fr` } as CSSProperties}
      >
        <LibraryView
          job={job}
          live={live}
          attach={attach}
          clearChapters={clearChapters}
          supportedSites={supportedSites}
          pushNotice={pushNotice}
          autoScan={launchChecked ? false : autoScan}
          onLaunchCheck={() => setLaunchChecked(true)}
          initialStory={normalView !== null && normalView !== true ? normalView : undefined}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <SplitHandle container={workbench} split={split} onSplit={setSplit} onCommit={saveSplit} />
      </div>

      <AppPlayerBar />

      {crawlLogOpen && <CrawlLogDialog job={job} onClose={() => setCrawlLogOpen(false)} />}
      {agentLogOpen && <AgentActivityDialog events={agent.events} busy={agent.busy} onClear={agent.clear} onClose={() => setAgentLogOpen(false)} />}
      <NoticeStack notices={notices} onDismiss={dismissNotice} />

    </div>
    )}

    <AppMenu
      anchor={lookMenu.menu?.anchor ?? null}
      entries={lookEntries}
      onClose={lookMenu.close}
      tone="app"
      label={t("Change look")}
    />

    {/* Fixed over everything, so the same page serves a skin and the normal view. */}
    {settingsOpen && (
      <SettingsOverlay
        theme={theme}
        onTheme={setTheme}
        onSaved={(settings: AppSettings) => setAutoScan(settings.autoScanOnOpen)}
        onClose={() => setSettingsOpen(false)}
      />
    )}
    </NarrationPlayerProvider>
  );
}

// Along the bottom of the app, whatever story is open: narration keeps playing while
// the reader browses. Its chapter title opens that story's reader at the chapter.
function AppPlayerBar() {
  const player = useNarrationPlayer();
  return <PlayerBar player={player} onShowChapter={player.requestOpen} />;
}
