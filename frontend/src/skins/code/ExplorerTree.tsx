import { ChevronDown, ChevronRight, Ellipsis, LoaderCircle } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { useLang } from "../../i18n";
import { TreeRow, parentKey } from "./tree";

export interface TreeHandlers {
  onToggleFolder: (storyId: string) => void;
  onOpenFile: (storyId: string, order: number, fromKeyboard: boolean) => void;
  onPage: (storyId: string, direction: 1 | -1) => void;
  onRetry: (storyId: string) => void;
  onSelect: (storyId: string) => void;
}

// A file's type glyph, the way the default icon theme draws Markdown.
export function MarkdownGlyph({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block w-4 flex-none text-center text-[9px] font-extrabold tracking-[-0.5px] text-code-type ${className}`}
      aria-hidden="true"
    >
      M↓
    </span>
  );
}

const ROW =
  "relative flex h-[22px] cursor-pointer items-center pr-3 text-[13px] outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-focus";

// The indent guide of a folder's children.
const GUIDE = "before:absolute before:inset-y-0 before:left-[15px] before:border-l before:border-code-border before:content-['']";

/**
 * The explorer's tree: story folders and their chapter files, a page at a time. Keys as
 * in the editor: Up/Down move, Right opens a folder (or steps into it), Left closes it
 * (or steps out to it), Enter/Space opens; Home/End jump. Every key it uses is marked
 * handled, so the narration player's shortcuts stay out of it.
 */
export function ExplorerTree({ rows, activeKey, handlers }: { rows: TreeRow[]; activeKey: string | null; handlers: TreeHandlers }) {
  const { t } = useLang();
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLDivElement>());
  const moveFocus = useRef(false);

  const tabStop =
    (focusKey && rows.some((row) => row.key === focusKey) && focusKey) ||
    (activeKey && rows.some((row) => row.key === activeKey) && activeKey) ||
    rows[0]?.key ||
    null;

  // Keyboard moves land on the new row once it is drawn (a page change draws it later).
  useEffect(() => {
    if (!moveFocus.current || !focusKey) return;
    const element = items.current.get(focusKey);
    if (!element) return;
    moveFocus.current = false;
    element.focus();
    element.scrollIntoView({ block: "nearest" });
  });

  // The open file stays in sight, like the editor's "reveal active file".
  useEffect(() => {
    if (activeKey) items.current.get(activeKey)?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  const focusRow = (key: string | null | undefined) => {
    if (!key) return;
    moveFocus.current = true;
    setFocusKey(key);
  };

  const activate = (row: TreeRow, fromKeyboard: boolean) => {
    if (row.kind === "folder") {
      handlers.onSelect(row.storyId);
      handlers.onToggleFolder(row.storyId);
    } else if (row.kind === "file") {
      handlers.onOpenFile(row.storyId, row.order, fromKeyboard);
    } else if (row.kind === "page") {
      handlers.onPage(row.storyId, row.direction);
      if (fromKeyboard) focusRow(row.focusAfter);
    } else if (row.note === "error") {
      handlers.onRetry(row.storyId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = rows.findIndex((row) => row.key === (focusKey ?? tabStop));
    const row = rows[index];
    if (!row) return;
    switch (event.key) {
      case "ArrowDown":
        focusRow(rows[Math.min(rows.length - 1, index + 1)]?.key);
        break;
      case "ArrowUp":
        focusRow(rows[Math.max(0, index - 1)]?.key);
        break;
      case "Home":
        focusRow(rows[0]?.key);
        break;
      case "End":
        focusRow(rows[rows.length - 1]?.key);
        break;
      case "ArrowRight":
        if (row.kind === "folder") {
          if (!row.expanded) activate(row, true);
          else if (rows[index + 1]?.level === 2) focusRow(rows[index + 1].key);
        }
        break;
      case "ArrowLeft":
        if (row.kind === "folder") {
          if (row.expanded) handlers.onToggleFolder(row.storyId);
        } else {
          focusRow(parentKey(row));
        }
        break;
      case "Enter":
      case " ":
        activate(row, true);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div role="tree" aria-label="Explorer" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2" onKeyDown={onKeyDown}>
      {rows.map((row) => {
        const selected = row.key === activeKey;
        const common = {
          ref: (element: HTMLDivElement | null) => {
            if (element) items.current.set(row.key, element);
            else items.current.delete(row.key);
          },
          role: "treeitem",
          "aria-level": row.level,
          tabIndex: row.key === tabStop ? 0 : -1,
          onFocus: () => setFocusKey(row.key),
          onClick: () => activate(row, false),
        };
        const tone = selected ? "bg-code-active text-code-text" : "text-code-fg hover:bg-code-hover";

        if (row.kind === "folder") {
          const Chevron = row.expanded ? ChevronDown : ChevronRight;
          const failed = row.errors > 0 && !row.crawl;
          return (
            <div
              key={row.key}
              {...common}
              aria-expanded={row.expanded}
              aria-selected={false}
              aria-posinset={row.posinset}
              aria-setsize={row.setsize}
              title={
                row.crawl
                  ? t("Downloading {done}/{total}", { done: row.crawl.cursor, total: row.crawl.total })
                  : failed
                    ? t("Download errors: {count}", { count: row.errors })
                    : undefined
              }
              className={`${ROW} pl-2 ${tone}`}
            >
              <Chevron size={16} className="flex-none" aria-hidden="true" />
              <span className={`min-w-0 flex-1 truncate ${failed ? "text-code-error" : ""}`}>{row.name}</span>
              {row.crawl ? (
                <span className="ml-2 flex flex-none items-center gap-1.5 text-[11px] text-code-dim" aria-hidden="true">
                  {row.crawl.cursor}/{row.crawl.total}
                  <span className="size-1.5 animate-pulse rounded-full bg-code-focus" />
                </span>
              ) : failed ? (
                <span className="ml-2 flex-none text-[11px] text-code-error" aria-hidden="true">
                  {row.errors > 99 ? "99+" : row.errors}
                </span>
              ) : row.pending ? (
                <span className="ml-2 flex-none text-[13px] leading-none text-code-added" aria-hidden="true">
                  •
                </span>
              ) : null}
            </div>
          );
        }

        if (row.kind === "file") {
          const description =
            row.state === "pending"
              ? t("Not downloaded yet.")
              : row.state === "running"
                ? t("Downloading…")
                : row.state === "error"
                  ? t("Download failed")
                  : undefined;
          return (
            <div
              key={row.key}
              {...common}
              aria-selected={selected}
              aria-posinset={row.posinset}
              aria-setsize={row.setsize}
              title={description}
              className={`${ROW} ${GUIDE} pl-8 ${tone}`}
            >
              <MarkdownGlyph className={`mr-1.5 ${row.state === "pending" ? "opacity-50" : ""}`} />
              <span
                className={`min-w-0 flex-1 truncate ${
                  row.state === "error" ? "text-code-error" : row.state === "pending" ? "text-code-dim" : ""
                }`}
              >
                {row.name}
              </span>
              {row.state === "pending" && (
                <span className="ml-2 w-3 flex-none text-center text-[11px] text-code-added opacity-70" aria-hidden="true">
                  U
                </span>
              )}
              {row.state === "error" && (
                <span className="ml-2 w-3 flex-none text-center text-[11px] text-code-error" aria-hidden="true">
                  1
                </span>
              )}
              {row.state === "running" && (
                <LoaderCircle size={12} className="ml-2 flex-none animate-spin text-code-dim" aria-hidden="true" />
              )}
            </div>
          );
        }

        if (row.kind === "page") {
          return (
            <div key={row.key} {...common} className={`${ROW} ${GUIDE} pl-8 text-code-dim hover:bg-code-hover`}>
              <Ellipsis size={14} className="mr-1.5 w-4 flex-none" aria-hidden="true" />
              <span className="truncate">{row.direction === 1 ? t("Load more…") : t("Show previous files…")}</span>
              <span className="ml-2 flex-none text-[11px]" aria-hidden="true">
                {row.from}–{row.to} / {row.total}
              </span>
            </div>
          );
        }

        return (
          <div
            key={row.key}
            {...common}
            aria-disabled={row.note !== "error"}
            className={`${ROW} ${GUIDE} pl-8 ${row.note === "error" ? "text-code-error hover:bg-code-hover" : "cursor-default text-code-dim"}`}
            title={row.note === "error" ? row.message : undefined}
          >
            {row.note === "loading" && <LoaderCircle size={12} className="mr-2 flex-none animate-spin" aria-hidden="true" />}
            <span className="truncate">
              {row.note === "loading"
                ? t("Loading…")
                : row.note === "empty"
                  ? t("No files")
                  : t("Could not load the files. Press Enter to retry.")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
