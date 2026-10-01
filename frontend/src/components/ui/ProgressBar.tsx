export function ProgressBar({
  pct,
  running,
  label,
}: {
  pct: number;
  running?: boolean;
  label: string;
}) {
  const width = Math.max(0, Math.min(100, pct));
  const className = ["bar", running ? "bar-running" : ""].filter(Boolean).join(" ");
  return (
    <div
      className={className}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      aria-label={label}
    >
      <i style={{ transform: `scaleX(${width / 100})` }} />
    </div>
  );
}
