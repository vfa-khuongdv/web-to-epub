import { ChevronLeft, ChevronRight, MessagesSquare, RefreshCw } from "lucide-react";
import { useLang } from "../../i18n";
import { Avatar } from "./Avatar";

export interface HomeRow {
  key: string;
  name: string;
  initials: string;
  tone: number;
  snippet: string;
  time: string;
  unread: number;
  busy: boolean;
  onOpen: () => void;
}

const LINK =
  "rounded-full px-3 py-1.5 text-[14px] font-medium text-chat-accent outline-none hover:bg-chat-accent-soft focus-visible:ring-2 focus-visible:ring-chat-accent";

// Grey bars where rows will be, as the chat draws a list that is still loading.
export function SkeletonRows({ count, label }: { count: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="px-4 py-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-4 py-3">
          <span className="size-10 flex-none animate-pulse rounded-[12px] bg-chat-skeleton" />
          <span className="flex-1 space-y-2">
            <span className="block h-3 w-1/3 animate-pulse rounded-full bg-chat-skeleton" />
            <span className="block h-3 w-2/3 animate-pulse rounded-full bg-chat-skeleton" />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Home: every space with its latest activity, unread ones in bold — the library. Paged,
 * so a very large library still draws a short list.
 */
export function HomeView({
  rows,
  loading,
  error,
  onRetry,
  onOpenDefault,
  paging,
}: {
  rows: HomeRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenDefault: () => void;
  paging: { text: string; onPrevious?: () => void; onNext?: () => void } | null;
}) {
  const { t } = useLang();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 flex-none items-center gap-3 border-b border-chat-rule px-6">
        <h1 className="text-[20px] font-normal text-chat-fg">Home</h1>
        <span
          className="ml-auto flex h-8 items-center gap-2 rounded-lg border border-chat-rule px-3 text-[13px] text-chat-dim"
          aria-hidden="true"
        >
          Unread
          <span className="h-4 w-7 rounded-full bg-chat-rule" />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="m-6 rounded-2xl bg-chat-error-soft px-5 py-4 text-[14px] text-chat-error" role="alert">
            <p className="font-medium">{t("Could not load the conversations.")}</p>
            <p className="mt-1 break-words opacity-90">{error}</p>
            <button type="button" className={`${LINK} -ml-3 mt-2 text-chat-error`} onClick={onRetry}>
              {t("Retry")}
            </button>
          </div>
        ) : loading && rows.length === 0 ? (
          <SkeletonRows count={7} label={t("Loading…")} />
        ) : rows.length === 0 ? (
          <div className="mx-auto mt-[12vh] flex max-w-[420px] flex-col items-center px-6 text-center">
            <span className="grid size-24 place-items-center rounded-full bg-chat-accent-soft text-chat-accent" aria-hidden="true">
              <MessagesSquare size={44} strokeWidth={1.4} />
            </span>
            <p className="mt-6 text-[16px] text-chat-fg">{t("No spaces yet. Add them in the normal view.")}</p>
            <button type="button" className={`${LINK} mt-3`} onClick={onOpenDefault}>
              {t("Open in the normal view")}
            </button>
          </div>
        ) : (
          <ul className="py-2" aria-label="Home">
            {rows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={row.onOpen}
                  className="flex w-full items-center gap-4 px-6 py-3 text-left outline-none hover:bg-chat-hover focus-visible:bg-chat-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-chat-accent"
                >
                  <Avatar name={row.name} tone={row.tone} text={row.initials} size={40} square />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={`min-w-0 truncate text-[15px] ${
                          row.unread > 0 ? "font-semibold text-chat-fg" : "text-chat-fg"
                        }`}
                      >
                        {row.name}
                      </span>
                      {row.busy && (
                        <RefreshCw
                          size={13}
                          strokeWidth={2}
                          className="flex-none animate-[spin_2.4s_linear_infinite] text-chat-online"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-[13.5px] ${
                        row.unread > 0 ? "font-medium text-chat-fg" : "text-chat-dim"
                      }`}
                    >
                      {row.snippet}
                    </span>
                  </span>
                  <span className="flex flex-none flex-col items-end gap-1">
                    <span className={`text-[12px] ${row.unread > 0 ? "font-semibold text-chat-fg" : "text-chat-faint"}`}>
                      {row.time}
                    </span>
                    {row.unread > 0 && (
                      <span className="min-w-[20px] rounded-full bg-chat-accent px-1.5 text-center text-[11px] font-semibold leading-[18px] text-chat-accent-fg">
                        {row.unread > 99 ? "99+" : row.unread}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {paging && (
        <div className="flex h-12 flex-none items-center justify-end gap-1 border-t border-chat-rule px-4 text-[13px] text-chat-dim">
          <span className="mr-2">{paging.text}</span>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full outline-none hover:bg-chat-rail-hover disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-chat-accent"
            onClick={paging.onPrevious}
            disabled={!paging.onPrevious}
            aria-label={t("Previous page")}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full outline-none hover:bg-chat-rail-hover disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-chat-accent"
            onClick={paging.onNext}
            disabled={!paging.onNext}
            aria-label={t("Next page")}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
