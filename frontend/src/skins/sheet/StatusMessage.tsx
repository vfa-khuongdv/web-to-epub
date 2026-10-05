import { LiveCrawl } from "../../hooks/useCrawlJob";
import { useLang } from "../../i18n";

/**
 * The left end of the status bar: "Ready", or the crawl in progress dressed as the
 * program recalculating, then a failed crawl command (click to dismiss) or a short notice.
 */
export function StatusMessage({
  crawls,
  crawlError,
  onDismissError,
  notice,
}: {
  // The crawls to sum up: the open story's, or every running one on the library sheet.
  crawls: LiveCrawl[];
  crawlError: string | null;
  onDismissError: () => void;
  notice: string | null;
}) {
  const { t } = useLang();
  const done = crawls.reduce((sum, crawl) => sum + crawl.cursor, 0);
  const total = crawls.reduce((sum, crawl) => sum + crawl.total, 0);
  const errors = crawls.reduce((sum, crawl) => sum + crawl.errors, 0);
  return (
    <>
      {crawls.length > 0 ? (
        <span className="whitespace-nowrap text-sheet-fg">
          Calculating: {done}/{total}
          {errors > 0 && <span className="text-sheet-negative"> · Errors: {errors}</span>}
        </span>
      ) : (
        <span>Ready</span>
      )}
      {crawlError ? (
        <button
          type="button"
          onClick={onDismissError}
          title={t("Dismiss")}
          className="min-w-0 truncate text-sheet-negative hover:underline"
        >
          {t("Download failed: {message}", { message: crawlError })}
        </button>
      ) : (
        notice && <span className="min-w-0 truncate text-sheet-fg">{notice}</span>
      )}
    </>
  );
}
