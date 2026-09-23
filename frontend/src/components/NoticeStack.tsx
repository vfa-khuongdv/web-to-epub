import { useEffect } from "react";
import { Notice } from "../hooks/useCrawlJob";
import { useLang } from "../i18n";
import { Icon } from "./Icon";

// Long enough to read, short enough not to sit in the way: a background job
// finishing is news, not a task waiting for an answer.
const AUTO_DISMISS_MS = 6000;

function Toast({ notice, onDismiss }: { notice: Notice; onDismiss: (id: number) => void }) {
  const { t } = useLang();

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notice.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice.id, onDismiss]);

  const failed = notice.kind === "crawl-done" && notice.errors > 0;
  // A run can end with failures or after a crash mid-way; say how far it got
  // instead of claiming a clean finish.
  const complete = notice.kind === "crawl-done" && notice.done >= notice.total && notice.errors === 0;

  return (
    <div
      role="status"
      className="flex max-w-[360px] items-center gap-2 rounded-tool border border-rule-2 bg-raised px-2.5 py-2 text-[12.5px] shadow-lg"
    >
      <Icon
        name={failed ? "alert" : "check"}
        size={14}
        className={`shrink-0${failed ? " text-error" : ""}`}
      />
      <p>
        {notice.kind === "toc-loaded" && t("Loaded {count} chapters", { count: notice.count })}
        {notice.kind === "session-saved" &&
          (notice.username
            ? t("Saved login for {username}", { username: notice.username })
            : t("Saved login session"))}
        {notice.kind === "crawl-done" &&
          (complete
            ? t("Downloaded {count} chapters", { count: notice.total })
            : t("Downloaded {done}/{total} chapters", { done: notice.done, total: notice.total }))}
        {notice.kind === "export-done" &&
          (notice.fileCount > 1
            ? t("Exported {count} EPUB files", { count: notice.fileCount })
            : t("Exported EPUB"))}
        {failed && <span className="font-semibold text-error"> · {t("{count} errors", { count: notice.errors })}</span>}
      </p>
      <button
        type="button"
        className="btn btn-quiet btn-tiny"
        aria-label={t("Close")}
        onClick={() => onDismiss(notice.id)}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

// Toasts for background work that finished while the app was open: a story's
// chapter list after an import, and a crawl. The job strip only tracks the story
// currently open, so this is how those endings are noticed from anywhere else.
export function NoticeStack({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: number) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="fixed right-3.5 bottom-16 z-50 flex flex-col items-end gap-2">
      {notices.map((notice) => (
        <Toast key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
