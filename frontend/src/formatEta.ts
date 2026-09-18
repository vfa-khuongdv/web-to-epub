// Backend ETA is an average estimate so we only need minute-level rounding; under one
// minute shows text instead of "~0 min".
export function formatEta(ms: number): string {
  if (ms < 60_000) return "under 1 min";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `~${hours} hr` : `~${hours} hr ${rest} min`;
}
