import { Ellipsis, Search, SquareTerminal } from "lucide-react";
import { useLang } from "../../i18n";

const BUTTON =
  "grid size-[24px] place-items-center rounded-[5px] text-term-bar-fg outline-none hover:bg-term-hover focus-visible:outline-1 focus-visible:outline-term-blue";

/**
 * The terminal window's title bar: window dots, the tab (titled by the shell, as zsh sets
 * the title to the running command), the window's size in cells, and two buttons — the
 * command palette and the menu (the normal view, looks, settings, hide). Without handlers
 * (the decoy) nothing in it acts or answers to the shell's accessible names.
 */
export function TermTitleBar({
  title,
  process,
  size,
  onPalette,
  onMenu,
}: {
  title: string;
  // What runs in the tab: zsh, less, sync.
  process: string;
  size: string | null;
  onPalette?: () => void;
  onMenu?: (element: HTMLElement) => void;
}) {
  const { t } = useLang();
  return (
    <div className="flex h-[34px] flex-none select-none items-end gap-2 border-b border-term-rule bg-term-bar pl-3 pr-2 font-ui text-[12px] text-term-bar-fg">
      <span className="flex h-full flex-none items-center gap-[7px] pr-1" aria-hidden="true">
        <span className="size-[11px] rounded-full bg-term-tab-off ring-1 ring-term-rule" />
        <span className="size-[11px] rounded-full bg-term-tab-off ring-1 ring-term-rule" />
        <span className="size-[11px] rounded-full bg-term-tab-off ring-1 ring-term-rule" />
      </span>
      <div
        className="-mb-px flex h-[28px] min-w-0 max-w-[min(440px,60vw)] items-center gap-1.5 rounded-t-[7px] border border-b-0 border-term-rule bg-term-tab px-3 text-term-fg"
        title={title}
      >
        <SquareTerminal size={13} aria-hidden="true" className="flex-none text-term-dim" />
        <span className="truncate">{title}</span>
        <span className="flex-none text-term-dim max-[520px]:hidden">— {process}</span>
      </div>
      <div className="flex h-full min-w-0 flex-1 items-center justify-end gap-1">
        {size && <span className="mr-2 font-term text-[11px] text-term-dim max-[640px]:hidden">{size}</span>}
        <button
          type="button"
          className={BUTTON}
          aria-label={onPalette ? t("Show and run commands") : undefined}
          title={onPalette ? `${t("Show and run commands")} (F1)` : undefined}
          tabIndex={onPalette ? 0 : -1}
          aria-hidden={onPalette ? undefined : true}
          onClick={onPalette}
        >
          <Search size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={BUTTON}
          aria-label={onMenu ? t("Terminal menu") : undefined}
          aria-haspopup={onMenu ? "menu" : undefined}
          tabIndex={onMenu ? 0 : -1}
          aria-hidden={onMenu ? undefined : true}
          onClick={(event) => onMenu?.(event.currentTarget)}
        >
          <Ellipsis size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// user@host and the folder, coloured as a usual zsh/bash prompt is.
export function PromptText({ path }: { path: string }) {
  return (
    <span className="select-none whitespace-pre">
      <span className="font-bold text-term-green">dev@workstation</span> <span className="font-bold text-term-blue">{path}</span> ${" "}
    </span>
  );
}
