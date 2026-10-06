import { KeyboardEvent, PointerEvent, RefObject } from "react";
import { useLang } from "../../i18n";
import { DEFAULT_SPLIT, MAX_SPLIT, MIN_SPLIT, clampSplit } from "../../lib/ui/splitPane";

const KEY_STEP = 0.02;

/**
 * The drag bar between the library list and the story page. `split` is the list's share of `container`'s
 * width; dragging moves it, the arrow keys nudge it, a double click puts it back. Hidden when the two
 * panes stack (narrow window), where there is no column edge to drag.
 */
export function SplitHandle({
  container,
  split,
  onSplit,
  onCommit,
}: {
  container: RefObject<HTMLElement | null>;
  split: number;
  onSplit: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const { t } = useLang();

  function move(event: PointerEvent<HTMLDivElement>) {
    const box = container.current?.getBoundingClientRect();
    if (!box || box.width === 0 || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onSplit(clampSplit((event.clientX - box.left) / box.width));
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === "ArrowLeft" ? split - KEY_STEP : event.key === "ArrowRight" ? split + KEY_STEP : event.key === "Home" ? MIN_SPLIT : event.key === "End" ? MAX_SPLIT : null;
    if (next === null) return;
    event.preventDefault();
    onSplit(clampSplit(next));
    onCommit(clampSplit(next));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Resize panels")}
      aria-valuemin={Math.round(MIN_SPLIT * 100)}
      aria-valuemax={Math.round(MAX_SPLIT * 100)}
      aria-valuenow={Math.round(split * 100)}
      tabIndex={0}
      className="group absolute inset-y-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none max-[1100px]:hidden"
      style={{ left: `${split * 100}%` }}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={move}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        onCommit(split);
      }}
      onDoubleClick={() => {
        onSplit(DEFAULT_SPLIT);
        onCommit(DEFAULT_SPLIT);
      }}
      onKeyDown={key}
    >
      <span className="mx-auto block h-full w-px bg-transparent transition-colors group-hover:bg-select group-focus-visible:bg-select group-active:bg-select" />
    </div>
  );
}
