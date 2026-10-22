// The file tree beside an open file, as the site shows it: "Files" with its collapse
// button, the branch, a "Go to file" box (Enter opens the first match) and every file of
// the repository, the open one marked and kept in view. Names only: a download ticking in
// the background does not redraw it.

import { ChevronDown, File, GitBranch, PanelLeftClose, Plus, Search } from "lucide-react";
import { KeyboardEvent, memo, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../../i18n";
import { FOCUS, ICON_BTN, INPUT } from "./RepoChrome";
import { BRANCH } from "./repoModel";

export interface TreeFile {
  order: number;
  name: string;
}

export const FileTreePanel = memo(function FileTreePanel({
  files,
  current,
  onOpen,
  onClose,
}: {
  files: TreeFile[];
  current: number;
  onOpen: (order: number) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [query, setQuery] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return wanted ? files.filter((file) => file.name.toLowerCase().includes(wanted)) : files;
  }, [files, query]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-tree-order="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && shown[0]) {
      event.preventDefault();
      onOpen(shown[0].order);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
    }
  };

  return (
    <aside aria-label="File tree" className="sticky top-0 hidden max-h-[100dvh] w-[300px] flex-none flex-col self-start border-r border-repo-border md:flex">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <button type="button" className={ICON_BTN} aria-label="Collapse file tree" title="Collapse file tree" onClick={onClose}>
          <PanelLeftClose size={16} aria-hidden="true" />
        </button>
        <h2 className="flex-1 text-[16px] font-semibold">Files</h2>
        <span className={ICON_BTN} aria-hidden="true">
          <Plus size={16} />
        </span>
        <span className={ICON_BTN} aria-hidden="true">
          <Search size={16} />
        </span>
      </div>
      <div className="px-4 pb-2">
        <span className="flex h-8 w-full items-center gap-1.5 rounded-md border border-repo-border bg-repo-btn px-3 text-[14px] font-medium" aria-hidden="true">
          <GitBranch size={16} className="text-repo-muted" />
          <span className="flex-1">{BRANCH}</span>
          <ChevronDown size={14} className="text-repo-muted" />
        </span>
      </div>
      <label className="relative mx-4 mb-2 flex items-center">
        <Search size={16} className="pointer-events-none absolute left-2 text-repo-muted" aria-hidden="true" />
        <input
          type="search"
          data-boss-key=""
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKey}
          placeholder="Go to file"
          aria-label={t("Go to file…")}
          className={`${INPUT} w-full pl-8`}
        />
      </label>
      <ul ref={list} role="tree" aria-label="Files" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {shown.map((file) => {
          const active = file.order === current;
          return (
            <li key={file.order} role="treeitem" aria-selected={active} data-tree-order={file.order}>
              <button
                type="button"
                onClick={() => onOpen(file.order)}
                title={file.name}
                className={`relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] ${FOCUS} ${
                  active
                    ? "bg-repo-btn-hover font-semibold after:absolute after:inset-y-1.5 after:left-0 after:w-1 after:rounded-full after:bg-repo-accent"
                    : "hover:bg-repo-btn-hover"
                }`}
              >
                <File size={16} className="flex-none text-repo-muted" aria-hidden="true" />
                <span className="min-w-0 truncate">{file.name}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2 py-4 text-center text-[12px] text-repo-muted">{t("No files matched your search.")}</li>}
      </ul>
    </aside>
  );
});
