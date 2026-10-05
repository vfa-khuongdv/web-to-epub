import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { KeyboardEvent, useEffect, useRef } from "react";
import { focusRing } from "./SheetChrome";

export interface SheetTab {
  key: string;
  name: string;
  closable: boolean;
}

/**
 * The sheet tabs along the bottom. Clicking activates, middle-click closes, the arrows
 * step between sheets and "+" opens the command palette (there is nothing to add here).
 * Arrow keys move along the tabs, as in any tab list.
 */
export function SheetTabs({
  tabs,
  active,
  onActivate,
  onClose,
  onAdd,
  labels,
}: {
  tabs: SheetTab[];
  active: string;
  // `keyboard`: moved along the tab list with the arrow keys, so focus stays on the tabs.
  onActivate?: (key: string, keyboard: boolean) => void;
  onClose?: (key: string) => void;
  onAdd?: () => void;
  // Accessible names; the decoy passes none, so its copy never answers to the shell's names.
  labels?: { list: string; previous: string; next: string; add: string };
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const moved = useRef(false);
  const at = Math.max(0, tabs.findIndex((tab) => tab.key === active));
  const interactive = !!onActivate;

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    buttons.current.get(active)?.focus();
  }, [active]);

  const step = (to: number, keyboard = false) => {
    const tab = tabs[Math.min(tabs.length - 1, Math.max(0, to))];
    if (tab) onActivate?.(tab.key, keyboard);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const to =
      event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (to === null) return;
    event.preventDefault();
    moved.current = true;
    step(to, true);
  };

  const navButton = "grid w-6 place-items-center text-sheet-dim hover:bg-sheet-hover disabled:opacity-40";

  return (
    <div className="flex h-[30px] flex-none items-stretch border-t border-sheet-rule bg-sheet-status text-[13px] text-sheet-fg select-none">
      <button
        type="button"
        className={`${navButton} ${focusRing}`}
        aria-label={labels?.previous}
        tabIndex={interactive ? 0 : -1}
        disabled={interactive && at === 0}
        onClick={() => step(at - 1)}
      >
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`${navButton} ${focusRing}`}
        aria-label={labels?.next}
        tabIndex={interactive ? 0 : -1}
        disabled={interactive && at === tabs.length - 1}
        onClick={() => step(at + 1)}
      >
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      <span className="mx-1 self-center text-sheet-dim" aria-hidden="true">
        …
      </span>
      <div
        role={labels ? "tablist" : undefined}
        aria-label={labels?.list}
        className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]"
        onKeyDown={interactive ? onKeyDown : undefined}
      >
        {tabs.map((tab) => {
          const on = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                if (el) buttons.current.set(tab.key, el);
                else buttons.current.delete(tab.key);
              }}
              type="button"
              role={labels ? "tab" : undefined}
              aria-selected={labels ? on : undefined}
              tabIndex={interactive && on ? 0 : -1}
              onClick={() => onActivate?.(tab.key, false)}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button === 1 && tab.closable) onClose?.(tab.key);
              }}
              className={`relative flex-none whitespace-nowrap border-r border-sheet-rule px-4 ${focusRing} ${
                on ? "bg-sheet-tab-on font-semibold text-sheet-select" : "hover:bg-sheet-hover"
              }`}
            >
              {tab.name}
              {on && <span aria-hidden="true" className="absolute inset-x-2 bottom-[3px] h-[2px] rounded-full bg-sheet-select" />}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={`mx-1.5 grid size-[22px] flex-none place-items-center self-center rounded-full text-sheet-dim hover:bg-sheet-hover ${focusRing}`}
        aria-label={labels?.add}
        tabIndex={interactive ? 0 : -1}
        onClick={onAdd}
      >
        <Plus size={15} aria-hidden="true" />
      </button>
      <div className="flex min-w-[40px] flex-1 items-center gap-1 pl-2 pr-3" aria-hidden="true">
        <span className="h-[14px] w-px bg-sheet-rule" />
        <span className="relative h-[9px] flex-1 rounded-full bg-sheet-cell/60">
          <span className="absolute top-[1px] left-[6%] h-[7px] w-[38%] rounded-full bg-sheet-rule" />
        </span>
      </div>
    </div>
  );
}
