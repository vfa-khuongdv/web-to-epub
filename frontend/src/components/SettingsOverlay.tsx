import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  changeVaultCode,
  fetchSettings,
  fetchSiteSession,
  removeSiteSession,
  saveSettings,
} from "../lib/api";
import { LANGUAGES, useLang } from "../i18n";
import { Theme, THEME_CYCLE, THEME_ICON, THEME_LABEL } from "../lib/theme";
import { timeAgo } from "../lib/timeAgo";
import { AppInfo, AppSettings } from "../types";
import { Icon } from "./Icon";
import SiteSessionDialog from "./SiteSessionDialog";
import { SkeletonBar } from "./Skeleton";
import { CODE_LENGTH, PinInput } from "./VaultPrompt";

// How long "Saved" stays on screen after a change lands.
const SAVED_FLASH_MS = 1600;

/**
 * The settings page: everything that belongs to the installation rather than to one
 * story. "Library" and "New book defaults" are saved server-side and shared by every
 * browser that opens this app; theme and interface language stay in this browser's
 * localStorage, which is where they were before this page existed and where a
 * per-screen preference belongs.
 *
 * Each control saves as it is changed — there is nothing here a reader would want to
 * change and then abandon, so the page has no Save button. The exception is the
 * private-mode code, which is a form: it needs the old code before it can take a new
 * one.
 */
export default function SettingsOverlay({
  theme,
  onTheme,
  onSaved,
  onClose,
}: {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  // Also reaches the library, which reads autoScanOnOpen.
  onSaved: (settings: AppSettings) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [data, setData] = useState<{ settings: AppSettings; app: AppInfo } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Escape closes the page, unless the code form has it first (see ChangeCodeForm).
  const [codeOpen, setCodeOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await fetchSettings());
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (codeOpen) setCodeOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [codeOpen, onClose]);

  const flashSaved = useCallback(() => {
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-chrome"
      role="dialog"
      aria-modal="true"
      aria-label={t("Settings")}
    >
      <header className="flex h-11 flex-none items-center gap-3 border-b border-rule-2 px-3.5">
        <button type="button" className="btn btn-quiet btn-tiny" onClick={onClose}>
          <Icon name="x" size={12} />
          {t("Close")}
        </button>
        <b className="text-sm">{t("Settings")}</b>
        <span className="ml-auto text-xs text-ink-3" role="status">
          {saved && t("Saved")}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-6">
          {data ? (
            <SettingsBody
              settings={data.settings}
              app={data.app}
              theme={theme}
              onTheme={onTheme}
              codeOpen={codeOpen}
              setCodeOpen={setCodeOpen}
              onSaved={(settings) => {
                setData((current) => (current ? { ...current, settings } : current));
                onSaved(settings);
                flashSaved();
              }}
              onFlashSaved={flashSaved}
            />
          ) : loadError ? (
            <p className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-error" role="alert">
              <Icon name="alert" size={13} />
              {loadError}
              <button type="button" className="btn btn-tiny" onClick={() => void load()}>
                {t("Try again")}
              </button>
            </p>
          ) : (
            <SettingsSkeleton />
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsBody({
  settings,
  app,
  theme,
  onTheme,
  codeOpen,
  setCodeOpen,
  onSaved,
  onFlashSaved,
}: {
  settings: AppSettings;
  app: AppInfo;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  codeOpen: boolean;
  setCodeOpen: (open: boolean) => void;
  onSaved: (settings: AppSettings) => void;
  onFlashSaved: () => void;
}) {
  const { lang, setLang, t } = useLang();
  const [author, setAuthor] = useState(settings.defaultAuthor);
  const [error, setError] = useState<string | null>(null);
  const [sessionConfigured, setSessionConfigured] = useState<boolean | null>(null);
  const [sessionSavedAt, setSessionSavedAt] = useState<string | undefined>(undefined);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);

  const loadSession = useCallback(async () => {
    try {
      const status = await fetchSiteSession();
      setSessionConfigured(status.configured);
      setSessionSavedAt(status.savedAt);
    } catch {
      setSessionConfigured(null);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function handleRemoveSession() {
    setError(null);
    try {
      await removeSiteSession();
      setSessionConfigured(false);
      onFlashSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function save(patch: Partial<AppSettings>) {
    setError(null);
    try {
      onSaved(await saveSettings(patch));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      {error && (
        <p
          className="flex items-center gap-2 rounded-tool border border-error-rule bg-error-soft px-2.5 py-1.5 text-[12.5px] text-error"
          role="alert"
        >
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}

      <Section title={t("Appearance")}>
        <Row
          label={t("Theme")}
          hint={t("Kept in this browser only.")}
          control={
            <div className="tabs">
              {THEME_CYCLE.map((option) => (
                <button key={option} type="button" aria-selected={theme === option} onClick={() => onTheme(option)}>
                  <Icon name={THEME_ICON[option]} size={13} />
                  {t(THEME_LABEL[option])}
                </button>
              ))}
            </div>
          }
        />
        <Row
          label={t("Interface language")}
          hint={t("Kept in this browser only.")}
          control={
            <select
              className="input w-44"
              aria-label={t("Interface language")}
              value={lang}
              onChange={(event) => setLang(event.target.value as typeof lang)}
            >
              {LANGUAGES.map((locale) => (
                <option key={locale.code} value={locale.code}>
                  {locale.label}
                </option>
              ))}
            </select>
          }
        />
      </Section>

      <Section title={t("Library")}>
        <Row
          label={t("Check for new chapters when the app opens")}
          hint={t(
            "Only stories you are watching are checked. With this off, check them yourself from the button above the story list."
          )}
          control={
            <input
              type="checkbox"
              className="size-4 accent-select"
              aria-label={t("Check for new chapters when the app opens")}
              checked={settings.autoScanOnOpen}
              onChange={(event) => void save({ autoScanOnOpen: event.target.checked })}
            />
          }
        />
      </Section>

      <Section title={t("New book defaults")}>
        <Row
          label={t("Book language")}
          hint={t("Filled in when a story is added. Editing the story's own info always wins.")}
          control={
            <select
              className="input w-44"
              aria-label={t("Book language")}
              value={settings.defaultBookLanguage}
              onChange={(event) => void save({ defaultBookLanguage: event.target.value })}
            >
              <option value="vi">{t("Vietnamese")}</option>
              <option value="en">{t("English")}</option>
            </select>
          }
        />
        <Row
          label={t("Author")}
          hint={t("Used when the chapter list does not name one. Leave empty for none.")}
          control={
            <input
              className="input w-44"
              aria-label={t("Author")}
              value={author}
              maxLength={200}
              onChange={(event) => setAuthor(event.target.value)}
              // Saved on the way out, not on every keystroke: this is a text field,
              // not a switch. The trimmed value is what is compared, sent and left in
              // the box, so the three cannot disagree.
              onBlur={() => {
                const trimmed = author.trim();
                if (trimmed === settings.defaultAuthor) return;
                setAuthor(trimmed);
                void save({ defaultAuthor: trimmed });
              }}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            />
          }
        />
      </Section>

      <Section title={t("Private mode")}>
        {app.privateConfigured ? (
          <>
            <Row
              label={t("A code has been set")}
              hint={t(
                "Private mode is a lock on this app, not encryption — the private library is a plain file on this machine."
              )}
              control={
                <button type="button" className="btn btn-tiny" onClick={() => setCodeOpen(!codeOpen)}>
                  <Icon name="lock" size={12} />
                  {t("Change code")}
                </button>
              }
            />
            {codeOpen && (
              <ChangeCodeForm
                onDone={() => {
                  setCodeOpen(false);
                  onFlashSaved();
                }}
                onCancel={() => setCodeOpen(false)}
              />
            )}
          </>
        ) : (
          <Row
            label={t("No code has been set")}
            hint={t("Press Cmd/Ctrl+Shift+N to open private mode and pick a code.")}
            control={null}
          />
        )}
      </Section>

      <Section title={t("Site sessions")}>
        <Row
          label="Asianfanfics"
          hint={
            sessionConfigured
              ? `${t("A saved login is in use for rated-M and subscribers-only stories.")}${
                  sessionSavedAt ? ` ${t("Saved {ago}.", { ago: timeAgo(sessionSavedAt, lang) })}` : ""
                }`
              : t("Rated-M and subscribers-only stories need a login saved from your own browser.")
          }
          control={
            <>
              <button type="button" className="btn btn-tiny" onClick={() => setSessionDialogOpen(true)}>
                <Icon name="lock" size={12} />
                {sessionConfigured ? t("Replace session") : t("Import session")}
              </button>
              {sessionConfigured && (
                <button type="button" className="btn btn-tiny" onClick={() => void handleRemoveSession()}>
                  {t("Remove")}
                </button>
              )}
            </>
          }
        />
        {sessionDialogOpen && (
          <SiteSessionDialog
            onSaved={() => {
              setSessionDialogOpen(false);
              setSessionConfigured(true);
              onFlashSaved();
            }}
            onSkip={() => setSessionDialogOpen(false)}
          />
        )}
      </Section>

      <Section title={t("About")}>
        <Fact label={t("Version")} value={app.version} />
        <Fact label={t("Library folder")} value={app.dataDir} mono />
        <Fact
          label={t("Stored")}
          value={t("{stories} stories, {chapters} chapters", {
            stories: app.storyCount,
            chapters: app.chapterCount,
          })}
        />
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-rule pb-6 last:border-b-0 last:pb-0">
      <h3 className="mb-3 text-[10.5px] font-[650] uppercase tracking-[0.07em] text-ink-2">{title}</h3>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

// One setting: what it is on the left, the control on the right, the reason underneath.
function Row({ label, hint, control }: { label: string; hint?: string; control: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-[13px]">{label}</div>
        {hint && <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{hint}</p>}
      </div>
      {control && <div className="flex flex-none items-center gap-1.5">{control}</div>}
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-[13px]">
      <span className="text-ink-2">{label}</span>
      <span className={mono ? "break-all font-mono text-[12px]" : undefined}>{value}</span>
    </div>
  );
}

/**
 * Changing the code asks for the current one — the server insists on it, and it is also
 * the only thing between a passer-by at an unlocked keyboard and a code of their own
 * choosing. The new code is asked twice for the reason setup asks twice: a typo in a
 * code nobody can recover locks the private library away for good.
 */
function ChangeCodeForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useLang();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = [current, next, confirm].every((code) => code.length === CODE_LENGTH);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    if (next !== confirm) {
      setError(t("The two codes do not match"));
      setConfirm("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changeVaultCode(current, next);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setCurrent("");
      setNext("");
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3 rounded-tool border border-rule bg-raised p-3.5" onSubmit={handleSubmit}>
      <PinInput
        id="settings-current-code"
        label={t("Current code")}
        value={current}
        onChange={setCurrent}
        disabled={busy}
        t={t}
      />
      <PinInput id="settings-new-code" label={t("New code")} value={next} onChange={setNext} disabled={busy} t={t} />
      <PinInput
        id="settings-confirm-code"
        label={t("Repeat the code")}
        value={confirm}
        onChange={setConfirm}
        disabled={busy}
        t={t}
      />

      {error && (
        <p className="flex items-center gap-2 text-[12.5px] text-error" role="alert">
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-tiny" onClick={onCancel} disabled={busy}>
          {t("Cancel")}
        </button>
        <button type="submit" className="btn btn-tiny btn-primary" disabled={!ready || busy}>
          {busy ? t("Saving…") : t("Change code")}
        </button>
      </div>
    </form>
  );
}

// How the real page is shaped: rows with a control per section, then the About block of
// plain facts. Kept beside the sections below so the two are edited together.
const SKELETON_SECTIONS = [2, 1, 2, 1];
const SKELETON_FACTS = 3;

/**
 * The settings page before its values arrive. Short-lived on a healthy server — the
 * values are one SQLite read — but it keeps the page from opening as an empty sheet
 * that then fills in, which reads worse than a page that is visibly still loading.
 */
function SettingsSkeleton() {
  const { t } = useLang();
  return (
    <>
      {/* Outside the aria-hidden sections, or it would be hidden along with them. */}
      <p className="visually-hidden" role="status">
        {t("Loading settings")}
      </p>

      {SKELETON_SECTIONS.map((rows, section) => (
        <section key={section} className="border-b border-rule pb-6" aria-hidden="true">
          <SkeletonBar className="mb-3 h-2.5 w-28" />
          <div className="flex flex-col gap-4">
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
                <div className="min-w-0 flex-1 basis-56">
                  <SkeletonBar className="h-3 w-2/5" />
                  <SkeletonBar className="mt-1.5 h-2.5 w-4/5" />
                </div>
                <SkeletonBar className="h-7 w-44 flex-none" />
              </div>
            ))}
          </div>
        </section>
      ))}

      <section aria-hidden="true">
        <SkeletonBar className="mb-3 h-2.5 w-28" />
        <div className="flex flex-col gap-4">
          {Array.from({ length: SKELETON_FACTS }, (_, fact) => (
            <div key={fact} className="flex items-baseline justify-between gap-6">
              <SkeletonBar className="h-3 w-24" />
              <SkeletonBar className="h-3 w-32" />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
