import { Bell, CircleX, GitBranch, RefreshCw, TriangleAlert } from "lucide-react";
import { useLang } from "../../i18n";

const ITEM = "flex h-full items-center gap-1 px-[5px] hover:bg-white/15";
const BUTTON = `${ITEM} outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-status-fg`;

/**
 * The status bar: branch and problem counts (failed chapters) on the left, with the
 * download progress while the open folder crawls; cursor line, word count and the file
 * format on the right while a file is open. Problem counts open PROBLEMS, the progress
 * opens the TERMINAL.
 */
export function StatusBar({
  errors,
  crawl,
  file,
  onProblems,
  onTerminal,
}: {
  errors: number;
  crawl: { cursor: number; total: number } | null;
  file: { line: number; words: number } | null;
  onProblems?: () => void;
  onTerminal?: () => void;
}) {
  const { t } = useLang();
  return (
    <div
      role="status"
      aria-label="Status bar"
      className="flex h-[22px] flex-none select-none items-center justify-between whitespace-nowrap bg-code-status pl-2 pr-1.5 text-[12px] text-code-status-fg"
    >
      <div className="flex h-full min-w-0 items-center">
        <span className={ITEM}>
          <GitBranch size={13} aria-hidden="true" />
          main
        </span>
        <span className={ITEM} aria-hidden="true">
          <RefreshCw size={12} />
        </span>
        <button type="button" className={BUTTON} aria-label={t("Problems: {count}", { count: errors })} onClick={onProblems}>
          <CircleX size={13} aria-hidden="true" />
          <span aria-hidden="true">{errors}</span>
          <TriangleAlert size={13} aria-hidden="true" className="ml-1" />
          <span aria-hidden="true">0</span>
        </button>
        {crawl && (
          <button
            type="button"
            className={BUTTON}
            aria-label={t("Downloading {done}/{total}", { done: crawl.cursor, total: crawl.total })}
            onClick={onTerminal}
          >
            <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
            <span aria-hidden="true">
              fetch: {crawl.cursor}/{crawl.total}
            </span>
          </button>
        )}
      </div>
      <div className="flex h-full items-center">
        {file && (
          <>
            <span className={ITEM}>Ln {file.line}, Col 1</span>
            <span className={`${ITEM} max-[720px]:hidden`}>{file.words.toLocaleString("en-US")} words</span>
            <span className={`${ITEM} max-[720px]:hidden`}>Spaces: 2</span>
            <span className={`${ITEM} max-[560px]:hidden`}>UTF-8</span>
            <span className={`${ITEM} max-[560px]:hidden`}>LF</span>
            <span className={ITEM}>Markdown</span>
          </>
        )}
        <span className={ITEM} aria-hidden="true">
          <Bell size={13} />
        </span>
      </div>
    </div>
  );
}
