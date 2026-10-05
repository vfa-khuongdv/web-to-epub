import { ChevronDown } from "lucide-react";
import { KeyboardEvent, useEffect, useRef } from "react";
import { useLang } from "../../i18n";
import { MarkdownGlyph } from "./ExplorerTree";
import { SearchResult } from "./tree";

const RESULT =
  "flex h-[22px] w-full cursor-pointer items-center pr-3 text-left text-[13px] outline-none hover:bg-code-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-focus";

/**
 * The search view: a filter over folder and file names (the names on screen, so neutral
 * names search as module-01 / part-0001). Enter opens the first hit; Up/Down walk the
 * results.
 */
export function SearchView({
  query,
  onQuery,
  result,
  focusToken,
  onOpenFolder,
  onOpenFile,
}: {
  query: string;
  onQuery: (query: string) => void;
  result: SearchResult;
  focusToken: number;
  onOpenFolder: (storyId: string) => void;
  onOpenFile: (storyId: string, order: number) => void;
}) {
  const { t } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusToken]);

  const results = () => Array.from(list.current?.querySelectorAll<HTMLElement>("[data-result]") ?? []);

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      results()[0]?.click();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      results()[0]?.focus();
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      onQuery("");
    }
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const all = results();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = at + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0) input.current?.focus();
    else all[Math.min(all.length - 1, next)]?.focus();
  };

  const files = result.count;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2 pt-0.5">
        <input
          ref={input}
          className="h-[26px] w-full rounded-[2px] border border-code-border bg-code-input px-1.5 text-[13px] text-code-text outline-none placeholder:text-code-dim focus:border-code-focus"
          placeholder="Search"
          aria-label={t("Search files by name")}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={onInputKey}
          spellCheck={false}
        />
      </div>
      {query.trim() && (
        <p className="px-5 pb-1.5 text-[12px] text-code-dim" role="status">
          {result.groups.length === 0 ? t("No results found.") : t("Files found: {count}", { count: files })}
        </p>
      )}
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto pb-2" onKeyDown={onListKey}>
        {result.groups.map((group) => (
          <div key={group.storyId}>
            <button type="button" data-result="" className={`${RESULT} pl-2 text-code-fg`} onClick={() => onOpenFolder(group.storyId)}>
              <ChevronDown size={16} className="flex-none" aria-hidden="true" />
              <span className={`truncate ${group.folderMatch ? "font-semibold text-code-text" : ""}`}>{group.folder}</span>
              {group.files.length > 0 && (
                <span
                  className="ml-auto flex-none rounded-full bg-code-active px-1.5 text-[11px] leading-[16px] text-code-fg"
                  aria-hidden="true"
                >
                  {group.files.length}
                </span>
              )}
            </button>
            {group.files.map((file) => (
              <button
                key={file.order}
                type="button"
                data-result=""
                className={`${RESULT} pl-8 ${file.state === "error" ? "text-code-error" : file.state === "pending" ? "text-code-dim" : "text-code-fg"}`}
                onClick={() => onOpenFile(group.storyId, file.order)}
              >
                <MarkdownGlyph className="mr-1.5" />
                <span className="truncate">{file.name}</span>
              </button>
            ))}
          </div>
        ))}
        {query.trim() && result.unsearched > 0 && (
          <p className="px-5 pt-2 text-[12px] leading-snug text-code-dim">{t("Only the files of open folders are searched.")}</p>
        )}
      </div>
    </div>
  );
}
