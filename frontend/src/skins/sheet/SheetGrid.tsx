import {
  KeyboardEvent,
  MouseEvent,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CellPos, columnName } from "./sheetModel";

// Height of an empty row (h-[22px] below), for counting how many fill the window.
const FILLER_ROW_PX = 22;
import { SheetRow } from "./sheetRows";

export interface SheetGridHandle {
  focus: () => void;
  // Scrolls by a screen and returns the first row now fully in view.
  pageScroll: (direction: 1 | -1) => number;
}

export type GridRestore = { top: number; left: number } | { row: number };

interface SheetGridProps {
  // CSS widths of the lettered columns.
  columns: readonly string[];
  rows: SheetRow[];
  selection: CellPos;
  // Changes when the selected cell should be scrolled into view.
  revealToken: number;
  // Empty rows drawn under the data, as a sheet goes on past its last row.
  fillerRows: number;
  zoom: number;
  // The chapter sheet: wrapped, top-aligned text in reading size.
  wrap?: boolean;
  // Keep the header row in view (Freeze Top Row), for the list sheets.
  freeze?: boolean;
  // The table's accessible name; the decoy draws its grid without one.
  label?: string;
  interactive?: boolean;
  // Where to scroll once the rows are there (`ready`): a remembered scroll offset, or a row
  // to put at the top.
  restore?: GridRestore | null;
  ready?: boolean;
  onSelect?: (pos: CellPos) => void;
  onOpen?: (row: number) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTableElement>) => void;
  // Every scroll, for the shell to remember where this view was.
  onScrollPos?: (top: number, left: number) => void;
  // The row at the top of the view (partly scrolled away counts), throttled.
  onTopRow?: (row: number) => void;
}

const ROW_HEADER = "42px";
const TOP_ROW_THROTTLE_MS = 300;

const cellBase = "relative border-b border-r border-sheet-grid px-[5px] text-sheet-fg scroll-ml-[44px]";

function Selection({ focused }: { focused: boolean }) {
  const tone = focused ? "border-sheet-select" : "border-sheet-select/45";
  return (
    <>
      <span aria-hidden="true" className={`pointer-events-none absolute -inset-[1.5px] z-[2] border-2 ${tone}`} />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute -right-[4px] -bottom-[4px] z-[3] size-[7px] border border-sheet-cell ${
          focused ? "bg-sheet-select" : "bg-sheet-select/45"
        }`}
      />
    </>
  );
}

const GridRow = memo(function GridRow({
  row,
  index,
  cols,
  selectedCol,
  focused,
  wrap,
  freeze,
}: {
  row: SheetRow;
  index: number;
  cols: number;
  // The selected column when the selection is on this row, else -1.
  selectedCol: number;
  focused: boolean;
  wrap: boolean;
  freeze: boolean;
}) {
  const on = selectedCol >= 0;
  // The frozen header row sticks under the column letters, with the darker line a
  // spreadsheet draws under frozen panes.
  const frozen = freeze && !!row.header;
  return (
    <tr data-row={index} data-frozen={frozen ? "" : undefined}>
      <th
        scope="row"
        className={`sticky left-0 border-r border-b border-sheet-rule px-1 text-center text-[12px] font-normal ${
          on ? "bg-sheet-head-on font-semibold text-sheet-select" : "bg-sheet-head text-sheet-head-fg"
        } ${frozen ? "top-[22px] z-[25] border-b-sheet-dim" : "z-10"} ${wrap && !row.header ? "align-top pt-[5px]" : ""}`}
      >
        {row.label}
      </th>
      {Array.from({ length: cols }, (_, col) => {
        const cell = row.cells[col];
        const wrapped = wrap && col === 1 && !row.header;
        const spill = !!cell?.spill && !wrapped;
        const classes = [
          cellBase,
          freeze ? "scroll-mt-[48px]" : "scroll-mt-[26px]",
          frozen ? "sticky top-[22px] z-[15] border-b-sheet-dim" : "",
          spill ? "z-[1]" : "",
          row.header ? "bg-sheet-select-soft font-bold" : "",
          cell?.bold ? "font-bold" : "",
          cell?.italic ? "italic" : "",
          cell?.tone === "negative" ? "text-sheet-negative" : cell?.tone === "dim" ? "text-sheet-dim" : "",
          cell?.align === "right" ? "text-right" : cell?.align === "center" ? "text-center" : "",
          wrap && !row.header ? "align-top" : "",
          wrapped ? (row.line === "heading" ? "py-[5px] text-[16px] leading-[1.5]" : "py-[4px] text-[15px] leading-[1.6]") : "",
          !wrapped ? (wrap && !row.header ? "pt-[3px] text-[13px] leading-[20px]" : "h-[22px] text-[14px] leading-[20px]") : "",
        ].join(" ");
        return (
          <td key={col} data-cell={`${index}:${col}`} className={classes}>
            {spill ? (
              <div className="whitespace-nowrap">
                <span className="bg-sheet-cell pr-1">{cell.text}</span>
              </div>
            ) : (
              <div className={wrapped ? "whitespace-pre-wrap break-words" : "overflow-hidden whitespace-nowrap"}>
                {cell?.text ?? ""}
              </div>
            )}
            {col === selectedCol && <Selection focused={focused} />}
          </td>
        );
      })}
    </tr>
  );
});

/**
 * The cell grid: lettered column headers and numbered rows that stay in view while the
 * sheet scrolls, gridlines, and the selected cell's border. It does not move the
 * selection itself — keys go to `onKeyDown`, clicks to `onSelect`/`onOpen` — and only
 * scrolls the selection into view when `revealToken` changes.
 */
export const SheetGrid = forwardRef<SheetGridHandle, SheetGridProps>(function SheetGrid(
  {
    columns,
    rows,
    selection,
    revealToken,
    fillerRows,
    zoom,
    wrap = false,
    freeze = false,
    label,
    interactive = true,
    restore = null,
    ready = true,
    onSelect,
    onOpen,
    onKeyDown,
    onScrollPos,
    onTopRow,
  },
  ref
) {
  const scroller = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  // The corner cell: sticky, so its bottom is where the column headers end on screen.
  const corner = useRef<HTMLTableCellElement>(null);
  const [focused, setFocused] = useState(false);
  const cols = columns.length;
  // Empty rows run to the bottom of the window whatever its height, as a real sheet's do:
  // a fixed count left a blank band under a short sheet on a tall screen.
  const [screenRows, setScreenRows] = useState(0);
  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setScreenRows(Math.ceil(element.clientHeight / (FILLER_ROW_PX * (zoom / 100))))
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [zoom]);
  const fillerCount = Math.max(fillerRows, screenRows);

  const rowElements = useCallback(
    () => Array.from(table.current?.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row]") ?? []),
    []
  );
  // Where the rows that scroll start on screen: under the column letters, and under the
  // frozen header row when there is one.
  const headerBottom = useCallback(() => {
    const frozen = table.current?.querySelector<HTMLElement>("tr[data-frozen] > th");
    const box = (frozen ?? corner.current ?? scroller.current)?.getBoundingClientRect();
    return box ? box.bottom : 0;
  }, []);

  // First row whose top (`full`) or bottom (`partial`) is below the column headers.
  const rowAtTop = useCallback(
    (edge: "full" | "partial"): number => {
      const list = rowElements();
      if (list.length === 0) return 0;
      const limit = headerBottom() - 1;
      let low = 0;
      let high = list.length - 1;
      let found = list.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const box = list[mid].getBoundingClientRect();
        if ((edge === "full" ? box.top : box.bottom) > limit) {
          found = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      return Number(list[found].dataset.row);
    },
    [rowElements, headerBottom]
  );

  const scrollRowToTop = useCallback(
    (row: number) => {
      const el = table.current?.querySelector<HTMLElement>(`tr[data-row="${row}"]`);
      if (!el || !scroller.current) return;
      scroller.current.scrollTop += el.getBoundingClientRect().top - headerBottom();
    },
    [headerBottom]
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => table.current?.focus({ preventScroll: true }),
      pageScroll: (direction) => {
        const box = scroller.current;
        if (!box) return 0;
        const headerHeight = headerBottom() - box.getBoundingClientRect().top;
        box.scrollTop += direction * Math.max(40, box.clientHeight - headerHeight - 28);
        return rowAtTop("full");
      },
    }),
    [headerBottom, rowAtTop]
  );

  // Restore once the data is drawn (a view comes back while its rows are still loading).
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !ready) return;
    restored.current = true;
    if (!restore || !scroller.current) return;
    if ("row" in restore) scrollRowToTop(restore.row);
    else {
      scroller.current.scrollTop = restore.top;
      scroller.current.scrollLeft = restore.left;
    }
  }, [ready, restore, scrollRowToTop]);

  // Reveal the selection when asked, waiting for its row to exist if the data is loading.
  const lastToken = useRef(revealToken);
  const pendingReveal = useRef(!restore);
  useLayoutEffect(() => {
    if (revealToken !== lastToken.current) {
      lastToken.current = revealToken;
      pendingReveal.current = true;
    }
    if (!pendingReveal.current) return;
    const cell = table.current?.querySelector<HTMLElement>(`[data-cell="${selection.row}:${selection.col}"]`);
    if (!cell) return;
    pendingReveal.current = false;
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [revealToken, rows, selection]);

  const topTimer = useRef<number | undefined>(undefined);
  const latestTopRow = useRef(onTopRow);
  latestTopRow.current = onTopRow;
  useEffect(
    () => () => {
      if (topTimer.current !== undefined) window.clearTimeout(topTimer.current);
    },
    []
  );

  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    onScrollPos?.(box.scrollTop, box.scrollLeft);
    if (!latestTopRow.current || topTimer.current !== undefined) return;
    topTimer.current = window.setTimeout(() => {
      topTimer.current = undefined;
      latestTopRow.current?.(rowAtTop("partial"));
    }, TOP_ROW_THROTTLE_MS);
  };

  const cellFrom = (event: MouseEvent): CellPos | null => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("td[data-cell]");
    if (!cell) return null;
    const [row, col] = cell.dataset.cell!.split(":").map(Number);
    return { row, col };
  };

  const width = `calc(${[ROW_HEADER, ...columns].join(" + ")})`;
  const fillerStart = (rows[rows.length - 1]?.label ?? 0) + 1;

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="relative min-h-0 flex-1 overflow-auto bg-sheet-cell [scrollbar-color:var(--color-sheet-rule)_transparent]"
    >
      <table
        ref={table}
        aria-label={label}
        tabIndex={interactive ? 0 : -1}
        onKeyDown={interactive ? onKeyDown : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="table-fixed border-separate border-spacing-0 font-sheet outline-none"
        style={{ width, zoom: zoom / 100 }}
      >
        <colgroup>
          <col style={{ width: ROW_HEADER }} />
          {columns.map((column, index) => (
            <col key={index} style={{ width: column }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th
              ref={corner}
              className="sticky top-0 left-0 z-30 h-[22px] border-r border-b border-sheet-rule bg-sheet-head p-0"
              aria-hidden="true"
            >
              <span className="absolute right-[3px] bottom-[3px] size-0 border-b-[9px] border-l-[9px] border-b-sheet-rule border-l-transparent" />
            </th>
            {columns.map((_, col) => {
              const on = col === selection.col;
              return (
                <th
                  key={col}
                  scope="col"
                  className={`sticky top-0 z-20 h-[22px] border-r border-sheet-rule text-center text-[12px] font-normal ${
                    on
                      ? "border-b-2 border-b-sheet-select bg-sheet-head-on font-semibold text-sheet-select"
                      : "border-b bg-sheet-head text-sheet-head-fg"
                  }`}
                >
                  {columnName(col)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody
          onMouseDown={
            interactive
              ? (event) => {
                  if (event.button !== 0) return;
                  const pos = cellFrom(event);
                  if (pos) onSelect?.(pos);
                }
              : undefined
          }
          onDoubleClick={
            interactive
              ? (event) => {
                  const pos = cellFrom(event);
                  if (pos) onOpen?.(pos.row);
                }
              : undefined
          }
          className={interactive ? "cursor-cell" : ""}
        >
          {rows.map((row, index) => (
            <GridRow
              key={row.key}
              row={row}
              index={index}
              cols={cols}
              selectedCol={index === selection.row ? selection.col : -1}
              focused={index === selection.row && (focused || !interactive)}
              wrap={wrap}
              freeze={freeze}
            />
          ))}
          {Array.from({ length: fillerCount }, (_, offset) => (
            <tr key={`filler-${offset}`} aria-hidden="true">
              <th className="sticky left-0 z-10 border-r border-b border-sheet-rule bg-sheet-head px-1 text-center text-[12px] font-normal text-sheet-head-fg">
                {fillerStart + offset}
              </th>
              {columns.map((_, col) => (
                <td key={col} className="h-[22px] border-r border-b border-sheet-grid" />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
