import { useEffect, useRef } from "react";
import { useLang } from "../../i18n";
import { AgentActivityEvent, describeAgentEvent } from "../../lib/format/agentActivity";
import { Icon } from "../ui/Icon";

/**
 * What the agent crawler is doing right now: the header button (only once it has done something this
 * session) and the log it opens. Each line is a step — the agent asked to write code, its answer, a
 * try that failed and why, the code saved, or saved code reused.
 */
export function AgentActivityButton({ events, busy, onOpen }: { events: AgentActivityEvent[]; busy: boolean; onOpen: () => void }) {
  const { t } = useLang();
  if (events.length === 0) return null;
  const last = events[events.length - 1];
  const failed = !busy && (last.kind === "failed" || last.kind === "locked");
  return (
    <button
      type="button"
      className={`btn btn-tiny ${busy ? "chip-running" : "btn-quiet"}`}
      onClick={onOpen}
      title={t("Show what the agent is doing")}
      aria-haspopup="dialog"
    >
      {busy ? (
        <Icon name="dot" size={12} className="animate-pulse" />
      ) : failed ? (
        <Icon name="alert" size={13} className="text-error" />
      ) : (
        <Icon name="sparkles" size={13} />
      )}
      {busy ? t("Agent working…") : t("Agent log")}
    </button>
  );
}

export function AgentActivityDialog({ events, busy, onClose }: { events: AgentActivityEvent[]; busy: boolean; onClose: () => void }) {
  const { t } = useLang();
  const logRef = useRef<HTMLDivElement | null>(null);
  // Follow new lines only while the reader is at the bottom, like the crawl log.
  const atBottom = useRef(true);

  useEffect(() => {
    const el = logRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [events]);

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
        aria-label={t("Agent log")}
      >
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          {busy ? <Icon name="dot" size={12} className="animate-pulse text-select" /> : <Icon name="sparkles" size={13} className="text-ink-3" />}
          <h2 className="min-w-0 truncate text-sm font-semibold">{busy ? t("Agent working…") : t("Agent log")}</h2>
          <button type="button" className="btn btn-quiet btn-tiny ml-auto" onClick={onClose}>
            <Icon name="x" size={12} />
            {t("Close")}
          </button>
        </div>
        <div
          ref={logRef}
          role="log"
          className="min-h-0 flex-1 overflow-auto bg-sunken px-4 py-2.5 font-mono text-[11.5px] leading-relaxed"
          onScroll={(event) => {
            const el = event.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
        >
          {events.length === 0 ? (
            <p className="text-ink-3">{t("Nothing logged yet.")}</p>
          ) : (
            events.map((event) => {
              const { text, isError } = describeAgentEvent(event, t);
              return (
                <p key={event.id} className={`break-words ${isError ? "text-error" : "text-ink-2"}`}>
                  <span className="mr-2 text-ink-3">{new Date(event.at).toLocaleTimeString("en-US", { hour12: false })}</span>
                  {text}
                </p>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
