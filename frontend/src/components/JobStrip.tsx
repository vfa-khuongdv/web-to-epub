import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { ProgressBar } from "./ProgressBar";
import { CrawlJobState } from "../useCrawlJob";
import { formatEta } from "../formatEta";

export function JobStrip({ job }: { job: CrawlJobState }) {
  const [open, setOpen] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    const el = logRef.current;
    if (open && el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [job.log, open]);

  const finished = !job.running && job.total > 0;
  const active = job.running || finished;

  return (
    <footer className="jobs">
      {open && job.log.length > 0 && (
        <div
          className="log"
          ref={logRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
        >
          {job.log.map((line, i) => (
            <p key={i} className={line.isError ? "error" : undefined}>
              <span className="mr-2 text-ink-3">{line.at}</span>
              {line.text}
            </p>
          ))}
        </div>
      )}
      <div className={active ? "jobs-bar jobs-active" : "jobs-bar"}>
        <span className="state">
          {job.running ? (
            <>
              <Icon name="dot" size={12} className="animate-pulse text-select" />
              <span className="what">{job.label}</span>
            </>
          ) : finished ? (
            <>
              {job.errors > 0 ? (
                <Icon name="alert" size={13} className="text-error" />
              ) : (
                <Icon name="check" size={13} />
              )}
              <span className="what">Xong · {job.label}</span>
            </>
          ) : (
            <>
              <Icon name="info" size={13} className="text-ink-3" />
              <span className="what">Sẵn sàng</span>
            </>
          )}
        </span>

        {(job.running || finished) && (
          <div className="track">
            <ProgressBar
              pct={job.pct}
              running={job.running}
              label={job.running ? "Tiến trình crawl" : "Lần crawl đã xong"}
            />
          </div>
        )}

        <span className="counts">
          {job.running && job.total === 0 && <span>Đang chuẩn bị…</span>}
          {job.total > 0 && (
            <span>
              {job.cursor}/{job.total} chương
            </span>
          )}
          {job.running && job.etaMs !== undefined && <span>· còn {formatEta(job.etaMs)}</span>}
          {job.errors > 0 && (
            <span className="bad">
              {job.errors} lỗi
            </span>
          )}
        </span>

        <span className="end">
          {job.log.length > 0 && (
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <Icon name="chapter" size={13} />
              Nhật ký ({job.log.length})
              <Icon name="chevron" size={12} className={open ? "rotate-90" : undefined} />
            </button>
          )}
        </span>
      </div>
    </footer>
  );
}
