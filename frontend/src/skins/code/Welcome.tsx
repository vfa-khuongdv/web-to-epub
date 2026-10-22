import { FileInput, FilePlus, Folder, FolderOpen, GitBranch, GraduationCap, Lightbulb, Rocket } from "lucide-react";
import { useLang } from "../../i18n";

export interface RecentFolder {
  storyId: string;
  name: string;
}

const RECENT_LIMIT = 10;

// Drawn, not working: the editor's own start entries and walkthroughs.
const START = [
  { Icon: FilePlus, label: "New File…" },
  { Icon: FileInput, label: "Open File…" },
  { Icon: FolderOpen, label: "Open Folder…" },
  { Icon: GitBranch, label: "Clone Git Repository…" },
];

const WALKTHROUGHS = [
  { Icon: Rocket, title: "Get Started with the Editor", detail: "Customize your editor, learn the basics, and start coding" },
  { Icon: Lightbulb, title: "Learn the Fundamentals", detail: "" },
  { Icon: GraduationCap, title: "Boost your Productivity", detail: "" },
];

const LINK =
  "flex items-center gap-2 rounded-[2px] text-left text-[13px] text-code-focus outline-none hover:underline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-code-focus";

/**
 * The welcome page shown when no file is open: the editor's start page, with the
 * library's stories as the recent folders. Opening one goes back to where the reader
 * left off. Start entries and walkthroughs are drawn, not working.
 */
export function Welcome({
  recent,
  loading,
  error,
  onOpenFolder,
  onMore,
  onOpenDefault,
  onRetry,
}: {
  recent: RecentFolder[];
  loading: boolean;
  error: string | null;
  onOpenFolder: (storyId: string) => void;
  onMore: () => void;
  onOpenDefault: () => void;
  onRetry: () => void;
}) {
  const { t } = useLang();
  return (
    <div className="mx-auto max-w-[920px] px-10 pb-16 pt-[8vh] font-ui">
      <h1 className="text-[34px] font-light leading-tight text-code-text">workspace</h1>
      <p className="mb-10 text-[19px] font-light text-code-dim">Pick up where you left off</p>
      <div className="grid gap-12 md:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="mb-2 text-[19px] font-normal text-code-text">Start</h2>
          <ul className="mb-8 space-y-1.5" aria-hidden="true">
            {START.map(({ Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-[13px] text-code-focus">
                <Icon size={16} strokeWidth={1.5} />
                {label}
              </li>
            ))}
          </ul>

          <h2 className="mb-2 text-[19px] font-normal text-code-text">Recent</h2>
          {error ? (
            <div className="text-[13px]">
              <p className="text-code-error">{error}</p>
              <button type="button" className={`${LINK} mt-1`} onClick={onRetry}>
                {t("Retry")}
              </button>
            </div>
          ) : loading && recent.length === 0 ? (
            <p className="text-[13px] text-code-dim">{t("Loading…")}</p>
          ) : recent.length === 0 ? (
            <div className="text-[13px] text-code-dim">
              <p>{t("This workspace has no folders yet. Add them in the normal view.")}</p>
              <button type="button" className={`${LINK} mt-1`} onClick={onOpenDefault}>
                {t("Open in the normal view")}
              </button>
            </div>
          ) : (
            <ul className="space-y-1">
              {recent.slice(0, RECENT_LIMIT).map((folder) => (
                <li key={folder.storyId} className="flex min-w-0 items-baseline gap-3">
                  <button type="button" className={`${LINK} min-w-0`} onClick={() => onOpenFolder(folder.storyId)}>
                    <Folder size={14} strokeWidth={1.5} className="flex-none" aria-hidden="true" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                  <span className="flex-none truncate text-[13px] text-code-dim" aria-hidden="true">
                    ~/workspace
                  </span>
                </li>
              ))}
              {recent.length > RECENT_LIMIT && (
                <li>
                  <button type="button" className={LINK} onClick={onMore}>
                    More…
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        <div aria-hidden="true">
          <h2 className="mb-2 text-[19px] font-normal text-code-text">Walkthroughs</h2>
          <div className="space-y-2">
            {WALKTHROUGHS.map(({ Icon, title, detail }) => (
              <div key={title} className="rounded-[4px] bg-code-side px-3 py-2.5">
                <div className="flex items-center gap-2.5 text-[13px] text-code-text">
                  <Icon size={18} strokeWidth={1.5} className="flex-none text-code-focus" />
                  {title}
                </div>
                {detail && <p className="ml-[28px] mt-1 text-[12px] text-code-dim">{detail}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-12 flex items-center gap-2 text-[12px] text-code-dim" aria-hidden="true">
        <span className="grid size-[14px] place-items-center rounded-[3px] border border-code-border bg-code-input text-[10px] text-code-text">
          ✓
        </span>
        Show welcome page on startup
      </p>
    </div>
  );
}
