import { ChevronLeft, ChevronRight, CircleAlert, Clock3, MessageSquare, RefreshCw, X } from "lucide-react";
import { ReactNode, useEffect, useRef } from "react";
import { useLang } from "../../i18n";
import { ShownStatus } from "../../lib/skins/chapters";

export interface ThreadEntry {
  key: string;
  label: string;
  status: ShownStatus;
  current: boolean;
  // Read already (at or before the saved position).
  read: boolean;
  onOpen: () => void;
}

const PAGER =
  "grid size-8 place-items-center rounded-full outline-none hover:bg-chat-rail-hover disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-chat-accent";

/**
 * The space's threads, one page at a time (a space can hold well over a thousand): the
 * open one highlighted, unread ones in bold with a dot, ones still to come and failed ones
 * marked. Beside the conversation on a wide window, over it on a narrow one.
 */
export function ThreadsPanel({
  entries,
  summary,
  paging,
  onClose,
  footer,
  loading,
}: {
  entries: ThreadEntry[];
  summary: string;
  paging: { text: string; onPrevious?: () => void; onNext?: () => void } | null;
  onClose: () => void;
  footer?: ReactNode;
  loading: boolean;
}) {
  const { t } = useLang();
  const list = useRef<HTMLUListElement>(null);
  const currentKey = entries.find((entry) => entry.current)?.key;

  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView({ block: "nearest" });
  }, [currentKey]);

  return (
    <aside
      aria-label="Threads"
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[360px] flex-col border-l border-chat-rule bg-chat-surface shadow-[-4px_0_16px_rgba(0,0,0,0.08)] lg:static lg:w-[340px] lg:shadow-none"
    >
      <div className="flex h-14 flex-none items-center gap-2 pl-5 pr-2">
        <h2 className="flex-1 text-[16px] font-normal text-chat-fg">Threads</h2>
        <button type="button" className={`${PAGER} size-9`} onClick={onClose} aria-label={t("Close")} title={t("Close")}>
          <X size={18} />
        </button>
      </div>
      <p className="flex-none px-5 pb-2 text-[12.5px] text-chat-dim">{summary}</p>
      <ul ref={list} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading && entries.length === 0 && (
          <li className="px-3 py-2 text-[13px] text-chat-dim">{t("Loading…")}</li>
        )}
        {entries.map((entry) => (
          <li key={entry.key}>
            <button
              type="button"
              onClick={entry.onOpen}
              aria-current={entry.current ? "true" : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-chat-accent ${
                entry.current ? "bg-chat-active text-chat-active-fg" : "hover:bg-chat-hover"
              }`}
            >
              <MessageSquare
                size={17}
                strokeWidth={1.8}
                className={`flex-none ${entry.current ? "" : "text-chat-faint"}`}
                aria-hidden="true"
              />
              <span
                className={`min-w-0 flex-1 truncate ${
                  entry.status !== "done"
                    ? "text-chat-faint"
                    : !entry.read && !entry.current
                      ? "font-semibold text-chat-fg"
                      : ""
                }`}
              >
                {entry.label}
              </span>
              {entry.status === "running" && (
                <RefreshCw size={14} className="flex-none animate-[spin_2.4s_linear_infinite] text-chat-online" aria-hidden="true" />
              )}
              {entry.status === "pending" && (
                <Clock3 size={14} className="flex-none text-chat-faint" aria-label={t("Not downloaded yet.")} />
              )}
              {entry.status === "error" && (
                <CircleAlert size={15} className="flex-none text-chat-error" aria-label={t("Download failed")} />
              )}
              {entry.status === "done" && !entry.read && !entry.current && (
                <span className="size-2 flex-none rounded-full bg-chat-accent" aria-hidden="true" />
              )}
            </button>
          </li>
        ))}
      </ul>
      {footer && <div className="flex-none border-t border-chat-rule px-5 py-3 text-[13px]">{footer}</div>}
      {paging && (
        <div className="flex h-12 flex-none items-center justify-between border-t border-chat-rule pl-5 pr-3 text-[12.5px] text-chat-dim">
          <span>{paging.text}</span>
          <span className="flex gap-1">
            <button
              type="button"
              className={PAGER}
              onClick={paging.onPrevious}
              disabled={!paging.onPrevious}
              aria-label={t("Previous page")}
            >
              <ChevronLeft size={18} />
            </button>
            <button type="button" className={PAGER} onClick={paging.onNext} disabled={!paging.onNext} aria-label={t("Next page")}>
              <ChevronRight size={18} />
            </button>
          </span>
        </div>
      )}
    </aside>
  );
}
