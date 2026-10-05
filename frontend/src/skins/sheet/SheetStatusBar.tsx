import { ChevronLeft, ChevronRight, File, Grid2x2, Minus, PersonStanding, Plus, SquareDashed } from "lucide-react";
import { ReactNode } from "react";
import { focusRing } from "./SheetChrome";

const VIEW_ICONS = [Grid2x2, File, SquareDashed];

export interface StatusPaging {
  text: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious?: () => void;
  onNext?: () => void;
}

/**
 * The status bar: "Ready" (or what the program is doing) on the left, the page controls
 * of a long sheet, then the selection's Count/Sum/Words, the view buttons and the zoom.
 */
export function SheetStatusBar({
  left,
  paging,
  summary,
  zoom,
  onZoom,
  zoomLabels,
  views,
  labelled = true,
}: {
  left: ReactNode;
  paging?: StatusPaging | null;
  summary: { label: string; value: string }[];
  zoom: number;
  onZoom?: (delta: number) => void;
  zoomLabels?: { out: string; in: string };
  // The real program's Normal / Page Layout / Page Break Preview buttons. Given by the
  // shell, they switch the app's look (this one, the code editor, the normal view).
  views?: { label: string; active: boolean; onClick: () => void }[];
  labelled?: boolean;
}) {
  const pageButton = `grid size-[20px] place-items-center rounded-[2px] hover:bg-sheet-hover disabled:opacity-35 ${focusRing}`;
  const zoomButton = `grid size-[18px] place-items-center rounded-[2px] hover:bg-sheet-hover ${focusRing}`;
  // The slider's thumb: 100% sits in the middle, as in the real thing.
  const thumb = zoom <= 100 ? ((zoom - 10) / 90) * 50 : 50 + ((zoom - 100) / 300) * 50;
  return (
    <div
      role={labelled ? "status" : undefined}
      aria-label={labelled ? "Status bar" : undefined}
      aria-live="off"
      className="flex h-[24px] flex-none items-center gap-3 border-t border-sheet-rule bg-sheet-status px-3 text-[12px] text-sheet-dim select-none"
    >
      <div className="flex min-w-0 items-center gap-3">{left}</div>
      <span className="hidden items-center gap-1 whitespace-nowrap lg:flex" aria-hidden="true">
        <PersonStanding size={13} /> Accessibility: Good to go
      </span>
      {paging && (
        <div className="flex flex-none items-center gap-1 text-sheet-fg">
          <button
            type="button"
            className={pageButton}
            aria-label={paging.previousLabel}
            disabled={!paging.onPrevious}
            onClick={paging.onPrevious}
          >
            <ChevronLeft size={13} aria-hidden="true" />
          </button>
          <span className="whitespace-nowrap tabular-nums">{paging.text}</span>
          <button
            type="button"
            className={pageButton}
            aria-label={paging.nextLabel}
            disabled={!paging.onNext}
            onClick={paging.onNext}
          >
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="ml-auto flex flex-none items-center gap-4 whitespace-nowrap">
        {summary.map((item) => (
          <span key={item.label} className="hidden tabular-nums text-sheet-fg sm:inline">
            {item.label}: {item.value}
          </span>
        ))}
        {views ? (
          <span className="flex items-center gap-1">
            {views.map((view, index) => {
              const Glyph = VIEW_ICONS[index] ?? Grid2x2;
              return (
                <button
                  key={view.label}
                  type="button"
                  aria-pressed={view.active}
                  aria-label={view.label}
                  title={view.label}
                  onClick={view.onClick}
                  className={`grid size-[20px] place-items-center rounded-[2px] text-sheet-fg hover:bg-sheet-hover ${
                    view.active ? "bg-sheet-head-on" : ""
                  } ${focusRing}`}
                >
                  <Glyph size={12} aria-hidden="true" />
                </button>
              );
            })}
          </span>
        ) : (
          <span className="hidden items-center gap-2.5 md:flex" aria-hidden="true">
            <span className="grid size-[18px] place-items-center rounded-[2px] bg-sheet-head-on text-sheet-fg">
              <Grid2x2 size={12} />
            </span>
            <File size={12} />
            <SquareDashed size={12} />
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            className={zoomButton}
            aria-label={zoomLabels?.out}
            tabIndex={onZoom ? 0 : -1}
            onClick={() => onZoom?.(-10)}
          >
            <Minus size={12} aria-hidden="true" />
          </button>
          <span className="relative hidden h-px w-[96px] bg-sheet-dim sm:block" aria-hidden="true">
            <span className="absolute -top-[4px] left-1/2 h-[9px] w-px bg-sheet-dim" />
            <span
              className="absolute -top-[6px] h-[13px] w-[5px] -translate-x-1/2 rounded-[1px] bg-sheet-fg"
              style={{ left: `${thumb}%` }}
            />
          </span>
          <button
            type="button"
            className={zoomButton}
            aria-label={zoomLabels?.in}
            tabIndex={onZoom ? 0 : -1}
            onClick={() => onZoom?.(10)}
          >
            <Plus size={12} aria-hidden="true" />
          </button>
          <span className="w-[34px] text-right tabular-nums text-sheet-fg">{zoom}%</span>
        </span>
      </div>
    </div>
  );
}
