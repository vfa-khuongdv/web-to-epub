/**
 * The one shape every skeleton is built from: a pulsing block standing in for a line of
 * text or a control. It carries no size of its own — the call site gives it the same
 * width and height as the thing it stands in for, so the real content lands without
 * moving anything.
 *
 * The fill is the text colour at a tenth, not a fixed grey: these bars sit on the white
 * of a pane and on the grey of the settings page, and in both themes, and a single flat
 * grey disappears into one of them.
 */
export function SkeletonBar({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-[2px] bg-ink/10 ${className ?? ""}`} />;
}
