import { ChevronUp, CircleX, Ellipsis, Info, Plus, TriangleAlert, X } from "lucide-react";
import { ComponentProps, KeyboardEvent } from "react";
import { useLang } from "../../i18n";
import { MarkdownGlyph } from "./ExplorerTree";
import { TerminalView } from "./TerminalView";

export type PanelTab = "problems" | "output" | "terminal";

export interface Problem {
  key: string;
  storyId: string | null;
  order: number | null;
  file: string;
  folder: string;
  message: string;
}

export interface OutputLine {
  tone: "info" | "warning" | "error";
  text: string;
}

// The panel's tabs in the editor's order; the two without a role here are only drawn.
const TABS: { id: PanelTab | null; label: string }[] = [
  { id: "problems", label: "Problems" },
  { id: "output", label: "Output" },
  { id: null, label: "Debug Console" },
  { id: "terminal", label: "Terminal" },
  { id: null, label: "Ports" },
];

const FUNCTIONAL = TABS.flatMap((tab) => (tab.id ? [tab.id] : []));

const ICON_BUTTON =
  "grid size-[22px] place-items-center rounded-[4px] text-code-fg hover:bg-code-hover outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-focus";

/**
 * The bottom panel: PROBLEMS (failed chapters of the open folder), OUTPUT (a summary of
 * the folder's downloads) and TERMINAL. Kept mounted while closed so the terminal keeps
 * its lines. Left/Right move between its tabs.
 */
export function Panel({
  open,
  tab,
  onTab,
  onClose,
  problems,
  onOpenProblem,
  output,
  terminal,
}: {
  open: boolean;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  problems: Problem[];
  onOpenProblem: (problem: Problem) => void;
  output: OutputLine[];
  terminal: ComponentProps<typeof TerminalView>;
}) {
  const { t } = useLang();

  const onTabsKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const at = FUNCTIONAL.indexOf(tab);
    const next = FUNCTIONAL[(at + (event.key === "ArrowRight" ? 1 : -1) + FUNCTIONAL.length) % FUNCTIONAL.length];
    onTab(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };

  return (
    <section
      hidden={!open}
      className="flex h-[240px] flex-none flex-col border-t border-code-border bg-code-panel"
      aria-label="Panel"
    >
      <div className="flex h-[35px] flex-none items-center justify-between pl-2 pr-2">
        <div role="tablist" aria-label="Panel" className="flex h-full items-center" onKeyDown={onTabsKey}>
          {TABS.map(({ id, label }) => {
            if (!id) {
              return (
                <span key={label} className="px-2.5 text-[11px] uppercase tracking-[0.02em] text-code-dim" aria-hidden="true">
                  {label}
                </span>
              );
            }
            const active = id === tab;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                data-tab={id}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={`flex h-full items-center gap-1.5 border-b px-2.5 text-[11px] uppercase tracking-[0.02em] outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-focus ${
                  active ? "border-code-fg text-code-text" : "border-transparent text-code-dim hover:text-code-fg"
                }`}
                onClick={() => onTab(id)}
              >
                {label}
                {id === "problems" && problems.length > 0 && (
                  <span className="rounded-full bg-code-active px-1.5 text-[11px] leading-[16px] text-code-fg">{problems.length}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-0.5">
          {tab === "terminal" && (
            <span className="mr-1 flex items-center gap-0.5 text-code-fg" aria-hidden="true">
              <span className="grid size-[22px] place-items-center">
                <Plus size={15} />
              </span>
              <span className="pr-1 text-[12px]">zsh</span>
            </span>
          )}
          <span className="grid size-[22px] place-items-center text-code-fg" aria-hidden="true">
            <Ellipsis size={16} />
          </span>
          <span className="grid size-[22px] place-items-center text-code-fg" aria-hidden="true">
            <ChevronUp size={16} />
          </span>
          <button type="button" className={ICON_BUTTON} aria-label={t("Close panel")} title={t("Close panel")} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div role="tabpanel" aria-label="Problems" hidden={tab !== "problems"} className="h-full overflow-y-auto py-1">
          {problems.length === 0 ? (
            <p className="px-5 text-[13px] text-code-fg">{t("No problems have been detected in the workspace.")}</p>
          ) : (
            <ul>
              {problems.map((problem) => (
                <li key={problem.key}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 px-5 py-[2px] text-left text-[13px] text-code-fg outline-none hover:bg-code-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-focus"
                    onClick={() => onOpenProblem(problem)}
                  >
                    <CircleX size={14} className="flex-none text-code-error" aria-hidden="true" />
                    {problem.order !== null && <MarkdownGlyph />}
                    <span className="flex-none">{problem.file}</span>
                    <span className="flex-none text-code-dim">{problem.folder}</span>
                    <span className="min-w-0 truncate">{problem.message}</span>
                    <span className="ml-auto flex-none pl-3 text-code-dim">[Ln 1, Col 1]</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          role="tabpanel"
          aria-label="Output"
          hidden={tab !== "output"}
          className="h-full overflow-y-auto px-5 py-1.5 font-mono text-[13px] leading-[19px]"
        >
          {output.map((line, index) => (
            <div key={index} className="flex items-start gap-2">
              {line.tone === "error" ? (
                <CircleX size={13} className="mt-[3px] flex-none text-code-error" aria-hidden="true" />
              ) : line.tone === "warning" ? (
                <TriangleAlert size={13} className="mt-[3px] flex-none text-code-warning" aria-hidden="true" />
              ) : (
                <Info size={13} className="mt-[3px] flex-none text-code-focus" aria-hidden="true" />
              )}
              <span className={`whitespace-pre-wrap break-words ${line.tone === "error" ? "text-code-error" : "text-code-text"}`}>
                {line.text}
              </span>
            </div>
          ))}
        </div>

        <div role="tabpanel" aria-label="Terminal" hidden={tab !== "terminal"} className="h-full">
          <TerminalView {...terminal} />
        </div>
      </div>
    </section>
  );
}
