// The Checks tab: the workflow's jobs down the left, the chosen job on the right — its
// summary line, a log search box, and each step, which opens to its numbered log lines.

import { ChevronDown, ChevronRight, Search, Workflow } from "lucide-react";
import { useState } from "react";
import { FOCUS, StatusIcon } from "../RepoChrome";
import { CheckJob } from "./types";
import { TimeAgo } from "./ui";

function duration(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export function ChecksTab({ checks, now, selected, onSelect }: { checks: CheckJob[]; now: number; selected: string; onSelect: (id: string) => void }) {
  const job = checks.find((check) => check.id === selected) ?? checks[0];
  // A failed job opens at the step that failed, as the site does.
  const failedStep = job.steps.findIndex((step) => step.log.some((line) => line.startsWith("Error:")));
  const [open, setOpen] = useState<Record<string, boolean>>(() => (failedStep >= 0 ? { [`${job.id}:${failedStep}`]: true } : {}));
  const [query, setQuery] = useState("");
  const wanted = query.trim().toLowerCase();

  return (
    <div className="grid gap-4 md:grid-cols-[256px_minmax(0,1fr)]">
      <nav aria-label="Checks" className="text-[14px]">
        <p className="mb-2 flex items-center gap-2 px-2 font-semibold">
          <Workflow size={16} className="text-repo-muted" aria-hidden="true" />
          {job.workflow}
        </p>
        <p className="mb-2 px-2 text-[12px] text-repo-muted">on: pull_request</p>
        <ul className="space-y-0.5">
          {checks.map((check) => {
            const active = check.id === job.id;
            return (
              <li key={check.id}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onSelect(check.id)}
                  className={`relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${FOCUS} ${
                    active ? "bg-repo-btn-hover font-semibold after:absolute after:inset-y-1.5 after:-left-2 after:w-1 after:rounded-full after:bg-repo-accent" : "hover:bg-repo-btn-hover"
                  }`}
                >
                  <StatusIcon status={check.status} size={16} />
                  <span className="min-w-0 flex-1 truncate">{check.name}</span>
                  <span className="text-[12px] font-normal text-repo-muted">{duration(check.seconds)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-label={job.name} className="min-w-0 overflow-hidden rounded-md border border-repo-border bg-repo-log text-repo-log-fg">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold">{job.name}</h3>
            <p className="text-[12px] text-repo-log-dim">
              {job.status === "success" ? "succeeded" : "failed"} <TimeAgo at={job.at} now={now} /> in {duration(job.seconds)}
            </p>
          </div>
          <label className="relative flex items-center">
            <Search size={14} className="pointer-events-none absolute left-2 text-repo-log-dim" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search logs"
              aria-label="Search logs"
              className="h-7 w-[220px] rounded-md border border-white/15 bg-white/5 pl-7 pr-2 text-[12px] text-repo-log-fg placeholder:text-repo-log-dim focus:border-repo-focus focus:outline-none"
            />
          </label>
        </div>
        <ul className="py-2 font-repo-mono text-[12px]">
          {job.steps.map((step, index) => {
            const key = `${job.id}:${index}`;
            const matches = wanted ? step.log.filter((line) => line.toLowerCase().includes(wanted)).length : 0;
            const expanded = open[key] || matches > 0;
            const failed = step.log.some((line) => line.startsWith("Error:"));
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen((all) => ({ ...all, [key]: !expanded }))}
                  className={`flex w-full items-center gap-2 px-4 py-1.5 text-left font-repo text-[14px] hover:bg-white/5 ${FOCUS}`}
                >
                  <span className="text-repo-log-dim">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                  <StatusIcon status={failed ? "failure" : "success"} size={16} />
                  <span className="min-w-0 flex-1 truncate">{step.name}</span>
                  {matches > 0 && <span className="rounded-full bg-repo-attention-dot px-1.5 text-[12px] text-black">{matches}</span>}
                  <span className="text-[12px] text-repo-log-dim">{duration(step.seconds)}</span>
                </button>
                {expanded && (
                  <ol className="pb-2">
                    {step.log.map((line, at) => {
                      const hit = wanted && line.toLowerCase().includes(wanted);
                      return (
                        <li key={at} className={`flex gap-4 px-4 leading-[20px] hover:bg-white/5 ${hit ? "bg-repo-attention-dot/20" : ""}`}>
                          <span className="w-8 flex-none select-none text-right text-repo-log-dim">{at + 1}</span>
                          <span className={`min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] ${line.startsWith("Error:") || line.includes(" FAIL ") ? "text-repo-log-error" : ""}`}>
                            {line || "​"}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
