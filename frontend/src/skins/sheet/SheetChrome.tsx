import { ChevronDown, Check, Grid3x3, MessageSquare, Redo2, Save, Search, Share2, Undo2, X } from "lucide-react";

// The spreadsheet program's frame: title bar, ribbon tabs and formula bar. Shared by the
// shell and the decoy, so both look like the same program. Mostly decoration; the parts
// that do something (the search box) take a handler. `labelled` is off in the decoy, so
// its copies of the named controls never clash with the shell's underneath it.

export const focusRing =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sheet-select";

export function TitleBar({
  fileName,
  onSearch,
  searchLabel,
}: {
  fileName: string;
  onSearch?: () => void;
  searchLabel?: string;
}) {
  return (
    <div className="flex h-8 flex-none items-center gap-2 bg-sheet-brand px-2 text-[12px] text-sheet-brand-fg select-none">
      <span className="grid size-6 place-items-center" aria-hidden="true">
        <Grid3x3 size={16} strokeWidth={2} />
      </span>
      <span className="hidden items-center gap-1.5 sm:flex">
        AutoSave
        <span className="flex h-[14px] w-[30px] items-center rounded-full border border-sheet-brand-fg/80 px-[2px]">
          <span className="size-[8px] rounded-full bg-sheet-brand-fg" />
          <span className="ml-[3px] text-[9px] leading-none">Off</span>
        </span>
      </span>
      <span className="hidden items-center gap-2.5 px-1 opacity-95 sm:flex" aria-hidden="true">
        <Save size={15} />
        <Undo2 size={15} />
        <Redo2 size={15} className="opacity-60" />
        <ChevronDown size={12} />
      </span>
      <span className="min-w-0 truncate pl-1">
        <span className="font-semibold">{fileName}</span>
        <span className="opacity-85"> • Saved to this PC</span>
      </span>
      <div className="flex min-w-0 flex-1 justify-center px-2">
        <button
          type="button"
          onClick={onSearch}
          tabIndex={onSearch ? 0 : -1}
          aria-label={searchLabel}
          className="flex h-6 w-full max-w-[380px] items-center gap-2 rounded-[4px] bg-sheet-brand-fg/20 px-2 text-left text-sheet-brand-fg/90 outline-none hover:bg-sheet-brand-fg/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sheet-brand-fg"
        >
          <Search size={14} aria-hidden="true" />
          <span className="truncate">Search (Alt+Q)</span>
        </button>
      </div>
      <span className="hidden items-center gap-3 md:flex" aria-hidden="true">
        <span className="grid size-6 place-items-center rounded-full bg-sheet-brand-fg/25 text-[10px] font-semibold">NH</span>
      </span>
    </div>
  );
}

const RIBBON_TABS = ["File", "Home", "Insert", "Page Layout", "Formulas", "Data", "Review", "View", "Help"];
// Tabs that open a real drop-down (the app's actions, the looks) when the shell asks.
export type RibbonMenu = "File" | "View";

export function RibbonTabs({ onMenu }: { onMenu?: (menu: RibbonMenu, element: HTMLElement) => void } = {}) {
  return (
    <div className="flex h-[30px] flex-none items-stretch gap-0.5 overflow-hidden bg-sheet-ribbon px-1.5 text-[13px] text-sheet-fg select-none">
      {RIBBON_TABS.map((tab) =>
        onMenu && (tab === "File" || tab === "View") ? (
          <button
            key={tab}
            type="button"
            aria-haspopup="menu"
            className={`relative flex items-center whitespace-nowrap rounded-[3px] px-2.5 hover:bg-sheet-hover ${focusRing}`}
            onClick={(event) => onMenu(tab, event.currentTarget)}
          >
            {tab}
          </button>
        ) : (
          <span
            key={tab}
            aria-hidden="true"
            className={`relative flex items-center whitespace-nowrap px-2.5 ${
              tab === "Home" ? "font-semibold text-sheet-select" : ""
            }`}
          >
            {tab}
            {tab === "Home" && <span className="absolute inset-x-2.5 bottom-0.5 h-[3px] rounded-full bg-sheet-select" />}
          </span>
        )
      )}
      <span className="ml-auto hidden items-center gap-3 pr-1 md:flex" aria-hidden="true">
        <span className="flex items-center gap-1.5 rounded-[4px] border border-sheet-rule px-2 py-[2px] text-[12px]">
          <MessageSquare size={14} /> Comments
        </span>
        <span className="flex items-center gap-1.5 rounded-[4px] bg-sheet-brand px-2.5 py-[3px] text-[12px] text-sheet-brand-fg">
          <Share2 size={13} /> Share
          <ChevronDown size={12} />
        </span>
      </span>
    </div>
  );
}

export function FormulaBar({
  address,
  formula,
  labelled = true,
}: {
  address: string;
  formula: string;
  labelled?: boolean;
}) {
  return (
    <div className="flex h-[27px] flex-none items-stretch border-y border-sheet-rule bg-sheet-cell text-[13px] text-sheet-fg">
      <div className="flex w-[104px] flex-none items-center justify-between border-r border-sheet-rule pl-2 pr-1">
        <div
          role="textbox"
          aria-readonly="true"
          aria-label={labelled ? "Name Box" : undefined}
          className="min-w-0 truncate"
        >
          {address}
        </div>
        <ChevronDown size={13} className="flex-none text-sheet-dim" aria-hidden="true" />
      </div>
      <div className="flex flex-none items-center gap-2.5 px-2.5 text-sheet-dim" aria-hidden="true">
        <span className="text-[10px] leading-none tracking-[-1px]">⋮</span>
        <X size={14} className="opacity-60" />
        <Check size={14} className="opacity-60" />
        <span className="font-serif text-[14px] italic text-sheet-fg">fx</span>
      </div>
      <input
        readOnly
        aria-label={labelled ? "Formula bar" : undefined}
        tabIndex={labelled ? 0 : -1}
        value={formula}
        className={`min-w-0 flex-1 border-l border-sheet-rule bg-sheet-cell px-2 text-[13px] text-sheet-fg ${focusRing}`}
      />
    </div>
  );
}
