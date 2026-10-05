import {
  AArrowDown,
  AArrowUp,
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDownAZ,
  ArrowDownToLine,
  Baseline,
  Bold,
  ChevronDown,
  ClipboardPaste,
  Copy,
  DollarSign,
  Eraser,
  Grid2x2,
  Grid2x2Plus,
  Grid2x2X,
  IndentDecrease,
  IndentIncrease,
  Italic,
  LayoutGrid,
  Paintbrush,
  PaintBucket,
  Palette,
  Percent,
  Scissors,
  Search,
  Sigma,
  Table2,
  TableCellsMerge,
  TableProperties,
  Underline,
  WrapText,
} from "lucide-react";
import { ReactNode } from "react";
import { focusRing } from "./SheetChrome";

// The Home ribbon, drawn to be believed from across the room. Only "Find & Select" does
// something (it opens the command palette); the rest is decoration, so it stays out of
// the tab order and out of the accessibility tree.

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-none flex-col border-r border-sheet-rule px-2 pt-1.5 pb-1">
      <div className="flex min-h-0 flex-1 items-start gap-1">{children}</div>
      <div className="pt-0.5 text-center text-[11px] leading-none text-sheet-dim">{label}</div>
    </div>
  );
}

function Big({ icon, label, caret }: { icon: ReactNode; label: string; caret?: boolean }) {
  return (
    <span className="flex w-[58px] flex-col items-center gap-1 pt-0.5 text-center text-[11px] leading-[1.15]">
      <span className="text-sheet-fg">{icon}</span>
      <span>
        {label}
        {caret && <ChevronDown size={10} className="ml-0.5 inline" />}
      </span>
    </span>
  );
}

// `compact` for the three-high stacks (Cut/Copy/Format Painter, Insert/Delete/Format).
function Small({ icon, label, caret, compact }: { icon: ReactNode; label?: string; caret?: boolean; compact?: boolean }) {
  return (
    <span className={`flex items-center gap-1 whitespace-nowrap px-1 text-[12px] ${compact ? "h-[19px]" : "h-[22px]"}`}>
      {icon}
      {label}
      {caret && <ChevronDown size={10} className="text-sheet-dim" />}
    </span>
  );
}

function Box({ text, width }: { text: string; width: string }) {
  return (
    <span
      className="flex h-[22px] items-center justify-between border border-sheet-rule bg-sheet-cell pl-1.5 pr-1 text-[12px]"
      style={{ width }}
    >
      <span className="truncate">{text}</span>
      <ChevronDown size={11} className="flex-none text-sheet-dim" />
    </span>
  );
}

// A colour swatch under an icon (fill colour, font colour).
function Swatch({ icon, className }: { icon: ReactNode; className: string }) {
  return (
    <span className="flex h-[22px] items-center gap-0.5 px-1">
      <span className="relative flex flex-col items-center">
        {icon}
        <span className={`-mt-[2px] h-[3px] w-[14px] ${className}`} />
      </span>
      <ChevronDown size={10} className="text-sheet-dim" />
    </span>
  );
}

const Sep = () => <span className="mx-0.5 h-[18px] w-px self-center bg-sheet-rule" />;

export function HomeRibbon({ onFind, findLabel }: { onFind?: () => void; findLabel?: string }) {
  const s = 15;
  return (
    <div className="flex h-[88px] flex-none items-stretch overflow-hidden border-b border-sheet-rule bg-sheet-ribbon py-1 text-sheet-fg select-none">
      {/* On a narrow window the decoration is cut off, never Find & Select. */}
      <div className="flex min-w-0 shrink items-stretch overflow-hidden" aria-hidden="true">
        <Group label="Clipboard">
          <Big icon={<ClipboardPaste size={26} strokeWidth={1.5} />} label="Paste" caret />
          <span className="flex flex-col">
            <Small compact icon={<Scissors size={s} />} />
            <Small compact icon={<Copy size={s} />} caret />
            <Small compact icon={<Paintbrush size={s} />} />
          </span>
        </Group>
        <Group label="Font">
          <span className="flex flex-col gap-1">
            <span className="flex items-center gap-1">
              <Box text="Calibri" width="124px" />
              <Box text="11" width="44px" />
              <AArrowUp size={16} className="ml-0.5" />
              <AArrowDown size={16} />
            </span>
            <span className="flex items-center">
              <Small icon={<Bold size={s} strokeWidth={2.5} />} />
              <Small icon={<Italic size={s} />} />
              <Small icon={<Underline size={s} />} caret />
              <Sep />
              <Small icon={<Grid2x2 size={s} />} caret />
              <Sep />
              <Swatch icon={<PaintBucket size={s} />} className="bg-yellow-300" />
              <Swatch icon={<Baseline size={s} />} className="bg-sheet-negative" />
            </span>
          </span>
        </Group>
        <Group label="Alignment">
          <span className="flex flex-col gap-1">
            <span className="flex items-center">
              <Small icon={<AlignVerticalJustifyStart size={s} />} />
              <Small icon={<AlignVerticalJustifyCenter size={s} />} />
              <Small icon={<AlignVerticalJustifyEnd size={s} />} />
              <Sep />
              <Small icon={<WrapText size={s} />} label="Wrap Text" />
            </span>
            <span className="flex items-center">
              <Small icon={<AlignLeft size={s} />} />
              <Small icon={<AlignCenter size={s} />} />
              <Small icon={<AlignRight size={s} />} />
              <Sep />
              <Small icon={<IndentDecrease size={s} />} />
              <Small icon={<IndentIncrease size={s} />} />
              <Small icon={<TableCellsMerge size={s} />} label="Merge & Center" caret />
            </span>
          </span>
        </Group>
        <Group label="Number">
          <span className="flex flex-col gap-1">
            <Box text="General" width="128px" />
            <span className="flex items-center">
              <Small icon={<DollarSign size={s} />} caret />
              <Small icon={<Percent size={s} />} />
              <Small icon={<span className="w-[14px] text-center text-[13px] font-semibold leading-none">,</span>} />
              <Small icon={<span className="text-[10px] leading-none">←.0</span>} />
              <Small icon={<span className="text-[10px] leading-none">.00→</span>} />
            </span>
          </span>
        </Group>
        <Group label="Styles">
          <Big icon={<Table2 size={24} strokeWidth={1.5} />} label="Conditional Formatting" caret />
          <Big icon={<LayoutGrid size={24} strokeWidth={1.5} />} label="Format as Table" caret />
          <Big icon={<Palette size={24} strokeWidth={1.5} />} label="Cell Styles" caret />
        </Group>
        <Group label="Cells">
          <span className="flex flex-col">
            <Small compact icon={<Grid2x2Plus size={s} />} label="Insert" caret />
            <Small compact icon={<Grid2x2X size={s} />} label="Delete" caret />
            <Small compact icon={<TableProperties size={s} />} label="Format" caret />
          </span>
        </Group>
      </div>
      <div className="flex flex-none flex-col px-2 pt-1.5 pb-1">
        <div className="flex min-h-0 flex-1 items-start gap-1">
          <span className="flex flex-col" aria-hidden="true">
            <Small compact icon={<Sigma size={s} />} label="AutoSum" caret />
            <Small compact icon={<ArrowDownToLine size={s} />} label="Fill" caret />
            <Small compact icon={<Eraser size={s} />} label="Clear" caret />
          </span>
          <span aria-hidden="true">
            <Big icon={<ArrowDownAZ size={24} strokeWidth={1.5} />} label="Sort & Filter" caret />
          </span>
          <button
            type="button"
            onClick={onFind}
            tabIndex={onFind ? 0 : -1}
            aria-label={findLabel}
            className={`rounded-[3px] hover:bg-sheet-hover ${focusRing}`}
          >
            <Big icon={<Search size={24} strokeWidth={1.5} />} label="Find & Select" caret />
          </button>
        </div>
        <div className="pt-0.5 text-center text-[11px] leading-none text-sheet-dim" aria-hidden="true">
          Editing
        </div>
      </div>
    </div>
  );
}
