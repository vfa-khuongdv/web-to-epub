// The seek, volume and music-volume bars: a 4px track that thickens on hover, and a square
// knob that only shows while the pointer or keyboard is on it. Shared by the player bar
// and the background music picker, so both look and behave the same.

// The played part in Instrument Blue, the rest in the sunken track.
export function playedStyle(value: number, max: number) {
  const pct = max > 0 ? Math.min(100, (Math.max(0, value) / max) * 100) : 0;
  return { backgroundImage: `linear-gradient(to right, var(--color-select) ${pct}%, var(--color-sunken) ${pct}%)` };
}

export const RANGE_CLASS = [
  "cursor-pointer appearance-none rounded-[2px] bg-sunken disabled:cursor-default disabled:opacity-40",
  "h-1 transition-[height] duration-150 hover:h-1.5",
  "[&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none",
  "[&::-webkit-slider-thumb]:rounded-[2px] [&::-webkit-slider-thumb]:bg-select [&::-webkit-slider-thumb]:opacity-0",
  "[&:hover::-webkit-slider-thumb]:opacity-100 [&:focus-visible::-webkit-slider-thumb]:opacity-100",
  "[&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:appearance-none",
  "[&::-moz-range-thumb]:rounded-[2px] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-select [&::-moz-range-thumb]:opacity-0",
  "[&:hover::-moz-range-thumb]:opacity-100 [&:focus-visible::-moz-range-thumb]:opacity-100",
].join(" ");
