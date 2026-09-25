import { useEffect, useRef } from "react";
import { CrawlJobState } from "../hooks/useCrawlJob";
import { formatEta } from "../lib/formatEta";
import { useLang } from "../i18n";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressBar";

/**
 * The crawl's status in the header: what is running (or how the last run ended), and
 * the way into its log. The log used to sit in a strip along the bottom of the window,
 * where it took height from the story list on every screen; it now opens on demand.
 * Nothing to show before the first crawl of the session.
 */
export function CrawlLogButton({ job, onOpen }: { job: CrawlJobState; onOpen: () => void }) {
  const { t } = useLang();
  const finished = !job.running && job.total > 0;
  if (!job.running && !finished && job.log.length === 0) return null;

  return (
    <button
      type="button"
      className={`btn btn-tiny ${job.running ? "chip-running" : "btn-quiet"}`}
      onClick={onOpen}
      title={t("Show the crawl log")}
      aria-haspopup="dialog"
    >
      {job.running ? (
        <Icon name="dot" size={12} className="animate-pulse" />
      ) : job.errors > 0 ? (
        <Icon name="alert" size={13} className="text-error" />
      ) : (
        <Icon name="check" size={13} />
      )}
      {job.running
        ? job.total > 0
          ? t("Crawling {done}/{total}", { done: job.cursor, total: job.total })
          : t("Crawling")
        : t("Crawl log")}
      {!job.running && job.errors > 0 && (
        <span className="font-semibold text-error">{t("{count} errors", { count: job.errors })}</span>
      )}
    </button>
  );
}

export function CrawlLogDialog({ job, onClose }: { job: CrawlJobState; onClose: () => void }) {
  const { lang, t } = useLang();
  const logRef = useRef<HTMLDivElement | null>(null);
  // Follow new lines only while the reader is at the bottom: scrolling up to read an
  // earlier error must not be yanked back down by the next line.
  const atBottom = useRef(true);
  const finished = !job.running && job.total > 0;

  useEffect(() => {
    const el = logRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [job.log]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-tool border border-rule-2 bg-raised shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={t("Crawl log")}
      >
        <div className="flex flex-col gap-2 border-b border-rule px-4 py-3">
          <div className="flex items-center gap-2">
            {job.running ? (
              <Icon name="dot" size={12} className="animate-pulse text-select" />
            ) : finished && job.errors > 0 ? (
              <Icon name="alert" size={13} className="text-error" />
            ) : finished ? (
              <Icon name="check" size={13} />
            ) : (
              <Icon name="info" size={13} className="text-ink-3" />
            )}
            <h2 className="min-w-0 truncate text-sm font-semibold">
              {job.running ? job.label : finished ? `${t("Done")} · ${job.label}` : t("Crawl log")}
            </h2>
            <button type="button" className="btn btn-quiet btn-tiny ml-auto" onClick={onClose}>
              <Icon name="x" size={12} />
              {t("Close")}
            </button>
          </div>

          {(job.running || finished) && (
            <ProgressBar
              pct={job.pct}
              running={job.running}
              label={job.running ? t("Crawl progress") : t("Crawl completed")}
            />
          )}

          <p className="flex flex-wrap gap-x-2 text-xs tabular-nums text-ink-2" role="status">
            {job.running && job.total === 0 && <span>{t("Preparing…")}</span>}
            {job.total > 0 && <span>{t("{done}/{total} chapters", { done: job.cursor, total: job.total })}</span>}
            {job.running && job.etaMs !== undefined && (
              <span>· {t("{eta} remaining", { eta: formatEta(job.etaMs, lang) })}</span>
            )}
            {job.errors > 0 && (
              <span className="font-semibold text-error">{t("{count} errors", { count: job.errors })}</span>
            )}
          </p>
        </div>

        <div
          ref={logRef}
          className="min-h-0 flex-1 overflow-auto bg-sunken px-4 py-2.5 font-mono text-[11.5px] leading-relaxed"
          onScroll={(event) => {
            const el = event.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
        >
          {job.log.length === 0 ? (
            <p className="text-ink-3">{t("Nothing logged yet.")}</p>
          ) : (
            job.log.map((line, i) => (
              <p key={i} className={`break-words ${line.isError ? "text-error" : "text-ink-2"}`}>
                <span className="mr-2 text-ink-3">{line.at}</span>
                {line.text}
              </p>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
