import { ChevronDown, ChevronRight, CopyMinus, Ellipsis, FilePlus, FolderPlus, RefreshCw } from "lucide-react";
import { ComponentProps, useState } from "react";
import { useLang } from "../../i18n";
import { SideView } from "./ActivityBar";
import { ExplorerTree, TreeHandlers } from "./ExplorerTree";
import { SearchView } from "./SearchView";
import { TreeRow } from "./tree";

const TITLES: Record<SideView, string> = {
  explorer: "Explorer",
  search: "Search",
  scm: "Source Control",
  run: "Run and Debug",
  extensions: "Extensions",
};

// What the views that are only drawn say (the editor's own empty states).
const EMPTY: Partial<Record<SideView, string>> = {
  scm: "The folder currently open doesn't have a git repository.",
  run: "To customize Run and Debug, open a folder and create a launch.json file.",
  extensions: "No extensions found.",
};

const ACTION =
  "grid size-[22px] place-items-center rounded-[4px] text-code-fg hover:bg-code-hover outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-focus";

const SECTION = "flex h-[22px] flex-none items-center text-[11px] font-bold uppercase tracking-[0.02em] text-code-fg";

export interface ExplorerProps {
  rows: TreeRow[];
  activeKey: string | null;
  handlers: TreeHandlers;
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRefresh: () => void;
  onCollapseAll: () => void;
  onOpenDefault: () => void;
}

export function SideBar({
  view,
  explorer,
  search,
}: {
  view: SideView;
  explorer: ExplorerProps;
  search: ComponentProps<typeof SearchView>;
}) {
  const { t } = useLang();
  const [workspaceOpen, setWorkspaceOpen] = useState(true);

  return (
    <aside className="flex w-[260px] flex-none flex-col border-r border-code-border bg-code-side" aria-label={TITLES[view]}>
      <div className="flex h-[35px] flex-none items-center justify-between pl-5 pr-2 text-[11px] uppercase tracking-[0.02em] text-code-fg">
        <span>{TITLES[view]}</span>
        <span className="grid size-[22px] place-items-center" aria-hidden="true">
          <Ellipsis size={16} />
        </span>
      </div>

      {view === "explorer" && (
        <>
          <div className={`${SECTION} group pr-2`}>
            <button
              type="button"
              className="flex h-full min-w-0 flex-1 items-center gap-0.5 pl-0.5 text-left outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-focus"
              aria-expanded={workspaceOpen}
              onClick={() => setWorkspaceOpen((open) => !open)}
            >
              {workspaceOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              <span className="truncate">workspace</span>
            </button>
            <span className="flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <span className={ACTION} aria-hidden="true">
                <FilePlus size={15} />
              </span>
              <span className={ACTION} aria-hidden="true">
                <FolderPlus size={15} />
              </span>
              <button type="button" className={ACTION} aria-label={t("Refresh")} title={t("Refresh")} onClick={explorer.onRefresh}>
                <RefreshCw size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={ACTION}
                aria-label={t("Collapse all folders")}
                title={t("Collapse all folders")}
                onClick={explorer.onCollapseAll}
              >
                <CopyMinus size={15} aria-hidden="true" />
              </button>
            </span>
          </div>
          {workspaceOpen ? <ExplorerBody {...explorer} /> : <div className="flex-1" />}
          <div className={`${SECTION} border-t border-code-border`} aria-hidden="true">
            <ChevronRight size={16} className="ml-0.5" />
            Outline
          </div>
          <div className={`${SECTION} border-t border-code-border`} aria-hidden="true">
            <ChevronRight size={16} className="ml-0.5" />
            Timeline
          </div>
        </>
      )}

      {view === "search" && <SearchView {...search} />}

      {EMPTY[view] && <p className="px-5 py-2 text-[13px] leading-snug text-code-fg">{EMPTY[view]}</p>}
    </aside>
  );
}

function ExplorerBody({ rows, activeKey, handlers, loading, error, empty, onRefresh, onOpenDefault }: ExplorerProps) {
  const { t } = useLang();
  if (error && rows.length === 0) {
    return (
      <div className="flex-1 px-5 py-2 text-[13px] leading-snug">
        <p className="text-code-error">{error}</p>
        <button type="button" className="mt-2 text-code-focus underline-offset-2 hover:underline" onClick={onRefresh}>
          {t("Retry")}
        </button>
      </div>
    );
  }
  if (loading && rows.length === 0) {
    return <p className="flex-1 px-5 py-2 text-[13px] text-code-dim">{t("Loading…")}</p>;
  }
  if (empty) {
    return (
      <div className="flex-1 px-5 py-2 text-[13px] leading-snug text-code-fg">
        <p>{t("This workspace has no folders yet. Add them in the normal view.")}</p>
        <button
          type="button"
          className="mt-3 w-full rounded-[2px] bg-code-status px-3 py-1 text-code-status-fg outline-none hover:opacity-90 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-code-focus"
          onClick={onOpenDefault}
        >
          {t("Open in the normal view")}
        </button>
      </div>
    );
  }
  return <ExplorerTree rows={rows} activeKey={activeKey} handlers={handlers} />;
}
