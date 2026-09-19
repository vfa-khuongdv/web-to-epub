import { Lang, translate } from "./i18n";

// Backend ETA is an average estimate so we only need minute-level rounding; under one
// minute shows text instead of "~0 min".
export function formatEta(ms: number, lang: Lang): string {
  if (ms < 60_000) return translate(lang, "under 1 min");
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return translate(lang, "~{count} min", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? translate(lang, "~{count} hr", { count: hours })
    : translate(lang, "~{hours} hr {minutes} min", { hours, minutes: rest });
}
