import { Blocks, BugPlay, CircleUserRound, Files, GitBranch, LucideIcon, Search, Settings } from "lucide-react";
import { useLang } from "../../i18n";
import { shortcut } from "./keys";

export type SideView = "explorer" | "search" | "scm" | "run" | "extensions";

// The editor's own view names (program chrome, not translated).
const VIEWS: { id: SideView; label: string; keys: string; Icon: LucideIcon }[] = [
  { id: "explorer", label: "Explorer", keys: "Mod+Shift+E", Icon: Files },
  { id: "search", label: "Search", keys: "Mod+Shift+F", Icon: Search },
  { id: "scm", label: "Source Control", keys: "Ctrl+Shift+G", Icon: GitBranch },
  { id: "run", label: "Run and Debug", keys: "Mod+Shift+D", Icon: BugPlay },
  { id: "extensions", label: "Extensions", keys: "Mod+Shift+X", Icon: Blocks },
];

const ITEM =
  "relative grid h-12 w-12 place-items-center border-l-2 outline-none focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-code-focus";

/**
 * The strip of view icons left of the side bar. Explorer and Search work; the other
 * views show their empty state. The gear opens the app's settings. Without handlers
 * (the decoy) it only draws.
 */
export function ActivityBar({
  view,
  sidebarOpen,
  onView,
  onSettings,
}: {
  view: SideView;
  sidebarOpen: boolean;
  onView?: (view: SideView) => void;
  onSettings?: () => void;
}) {
  const { t } = useLang();
  const interactive = !!onView;
  return (
    <nav className="flex w-12 flex-none flex-col justify-between bg-code-activity" aria-label="Activity bar">
      <div className="flex flex-col">
        {VIEWS.map(({ id, label, keys, Icon }) => {
          const active = sidebarOpen && view === id;
          return (
            <button
              key={id}
              type="button"
              className={`${ITEM} ${
                active ? "border-code-activity-fg text-code-activity-fg" : "border-transparent text-code-activity-dim hover:text-code-activity-fg"
              }`}
              aria-label={label}
              aria-pressed={active}
              title={`${label} (${shortcut(keys)})`}
              tabIndex={interactive ? 0 : -1}
              onClick={() => onView?.(id)}
            >
              <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="flex flex-col">
        <span className={`${ITEM} border-transparent text-code-activity-dim`} aria-hidden="true">
          <CircleUserRound size={24} strokeWidth={1.5} />
        </span>
        <button
          type="button"
          className={`${ITEM} border-transparent text-code-activity-dim hover:text-code-activity-fg`}
          aria-label={t("Settings")}
          title={t("Settings")}
          tabIndex={interactive ? 0 : -1}
          onClick={onSettings}
        >
          <Settings size={24} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
