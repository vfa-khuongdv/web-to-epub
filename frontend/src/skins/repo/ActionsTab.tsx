import { ChevronDown, ChevronRight, CirclePlay, Ellipsis, Workflow } from "lucide-react";
import { ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { useLang } from "../../i18n";
import { BOX, BTN, BTN_SM, Blankslate, Label, StatusIcon, StatusKind } from "./RepoChrome";
import { BRANCH, BOT, relativeTime } from "./repoModel";
import { LogRow, RunSummary } from "./runLog";

const WORKFLOW = "Build docs";

/**
 * The Actions tab: the open story's download as a workflow run. "Run workflow" starts
 * it, "Cancel run" stops it; the run's "Sync files" step prints the crawl log with every
 * address replaced by a file name (runLog.ts). An earlier, finished run sits under it so
 * the list never looks brand new.
 */
export function ActionsTab({
  run,
  number,
  log,
  lastRunAt,
  onRun,
  onCancel,
  now,
}: {
  run: RunSummary | null;
  number: number;
  log: LogRow[];
  // When the files last changed: the earlier run's date. Null when nothing was ever fetched.
  lastRunAt: string | null;
  onRun: (() => void) | null;
  onCancel: (() => void) | null;
  now: number;
}) {
  const { t } = useLang();
  const runs = (run ? 1 : 0) + (lastRunAt ? 1 : 0);
  const kind: StatusKind | null = run ? run.status : null;
  const progress = run
    ? run.status === "running"
      ? t("Downloading {done}/{total}", { done: run.done, total: run.total })
      : t("Downloaded {done}/{total}", { done: run.done, total: run.total })
    : "";

  return (
    <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-hidden="true" className="hidden text-[14px] md:block">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[20px] font-semibold">Actions</h2>
          <span className={BTN_SM}>New workflow</span>
        </div>
        <ul className="space-y-0.5">
          <li className="relative rounded-md bg-repo-btn-hover px-2 py-1.5 font-semibold before:absolute before:inset-y-1.5 before:-left-2 before:w-1 before:rounded-full before:bg-repo-accent">
            All workflows
          </li>
          <li className="rounded-md px-2 py-1.5">{WORKFLOW}</li>
        </ul>
        <p className="mb-1 mt-5 px-2 text-[12px] font-semibold text-repo-muted">Management</p>
        <ul className="space-y-0.5 text-repo-fg">
          <li className="rounded-md px-2 py-1.5">Caches</li>
          <li className="rounded-md px-2 py-1.5">Runners</li>
        </ul>
      </nav>

      <div className="min-w-0">
        <h2 className="text-[20px] font-semibold">All workflows</h2>
        <p className="mb-4 text-[14px] text-repo-muted">Showing runs from all workflows</p>

        <div className={`${BOX} mb-4 flex flex-wrap items-center gap-3 bg-repo-subtle px-4 py-3 text-[14px]`}>
          <span className="min-w-0 flex-1">
            This workflow has a <code className="rounded-md bg-repo-counter px-1 font-repo-mono text-[12px]">workflow_dispatch</code> event trigger.
          </span>
          {onCancel ? (
            <button type="button" className={BTN} onClick={onCancel} title={t("Stop downloading")}>
              Cancel run
            </button>
          ) : (
            onRun && (
              <button type="button" className={BTN} onClick={onRun} title={t("Download the rest")}>
                Run workflow
                <ChevronDown size={14} className="text-repo-muted" aria-hidden="true" />
              </button>
            )
          )}
        </div>

        <div className={BOX}>
          <div className="flex flex-wrap items-center gap-2 rounded-t-md border-b border-repo-border bg-repo-subtle px-4 py-3 text-[14px]">
            <b className="mr-auto">
              {runs} workflow run{runs === 1 ? "" : "s"}
            </b>
            <span className="hidden gap-4 text-repo-muted sm:flex" aria-hidden="true">
              {["Event", "Status", "Branch", "Actor"].map((name) => (
                <span key={name} className="flex items-center gap-1">
                  {name}
                  <ChevronDown size={14} />
                </span>
              ))}
            </span>
          </div>
          {runs === 0 ? (
            <Blankslate icon={<Workflow size={24} />} title={t("There are no workflow runs yet.")} />
          ) : (
            <ul aria-label="Workflow runs">
              {run && kind && (
                <RunRow
                  status={kind}
                  title={WORKFLOW}
                  subtitle={`${WORKFLOW} #${number}: Manually run by ${BOT}`}
                  when={run.status === "running" ? "now" : "just now"}
                  detail={progress}
                />
              )}
              {lastRunAt && (
                <RunRow
                  status="success"
                  title={WORKFLOW}
                  subtitle={`${WORKFLOW} #${run ? number - 1 : number}: Scheduled`}
                  when={relativeTime(lastRunAt, now)}
                />
              )}
            </ul>
          )}
        </div>

        {run && kind && (
          <section className={`${BOX} mt-6`} aria-label="build">
            <div className="flex items-center gap-2 rounded-t-md border-b border-repo-border bg-repo-subtle px-4 py-3 text-[14px]">
              <StatusIcon status={kind} size={16} spin />
              <b>build</b>
              <span className="min-w-0 truncate text-repo-muted">
                {progress}
                {run.errors > 0 && ` · ${t("Download errors: {count}", { count: run.errors })}`}
              </span>
            </div>
            <div className="bg-repo-log py-2 font-repo-mono text-[12px] text-repo-log-fg">
              <Step status="success" name="Set up job" />
              <Step status="success" name="Check out repository" />
              <Step status={kind} name="Sync files" open>
                <LogLines rows={log} />
              </Step>
              <Step status={kind === "running" ? "queued" : kind} name="Complete job" />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function RunRow({ status, title, subtitle, when, detail }: { status: StatusKind; title: string; subtitle: string; when: string; detail?: string }) {
  return (
    <li className="flex items-start gap-3 border-t border-repo-border-muted px-4 py-3 text-[14px] first:border-t-0">
      <span className="pt-0.5">
        <StatusIcon status={status} size={16} spin />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate">{title}</b>
        <span className="block truncate text-[12px] text-repo-muted">{subtitle}</span>
        {detail && <span className="block truncate text-[12px] text-repo-muted">{detail}</span>}
      </span>
      <span className="hidden sm:block">
        <Label tone="accent">{BRANCH}</Label>
      </span>
      <span className="w-[110px] flex-none text-right text-[12px] text-repo-muted">
        <span className="flex items-center justify-end gap-1">
          <CirclePlay size={14} aria-hidden="true" />
          {when}
        </span>
      </span>
      <Ellipsis size={16} className="flex-none text-repo-muted" aria-hidden="true" />
    </li>
  );
}

function Step({ status, name, open = false, children }: { status: StatusKind; name: string; open?: boolean; children?: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-1.5 text-[13px]">
        {open ? <ChevronDown size={14} className="text-repo-log-dim" aria-hidden="true" /> : <ChevronRight size={14} className="text-repo-log-dim" aria-hidden="true" />}
        <StatusIcon status={status} size={14} spin />
        <span className="font-repo">{name}</span>
      </div>
      {open && children}
    </div>
  );
}

// The step's log, following the end while the reader is at the end (like the site's
// log viewer), and left alone when they scrolled up to read an earlier line.
function LogLines({ rows }: { rows: LogRow[] }) {
  const { t } = useLang();
  const box = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onScroll = () => {
      atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    const element = box.current;
    if (element && atEnd.current) element.scrollTop = element.scrollHeight;
  }, [rows]);
  return (
    <div ref={box} role="log" aria-label="Log" className="max-h-[50vh] overflow-y-auto pb-2 pl-10 pr-4">
      {rows.length === 0 ? (
        <p className="py-1 text-repo-log-dim">{t("Nothing is downloading.")}</p>
      ) : (
        rows.map((row) => (
          <div key={row.number} className="flex gap-4 leading-[20px]">
            <span className="w-8 flex-none select-none text-right text-repo-log-dim">{row.number}</span>
            <span className="flex-none select-none text-repo-log-dim">{row.at}</span>
            <span className={`min-w-0 whitespace-pre-wrap break-words ${row.error ? "text-repo-log-error" : ""}`}>
              {row.error ? `Error: ${row.text}` : row.text}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
