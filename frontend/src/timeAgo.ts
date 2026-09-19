import { Lang, translate } from "./i18n";

// "Updated" and "last checked" both need relative time; keep in one place so both
// display sites match.
export function timeAgo(iso: string, lang: Lang): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return translate(lang, "just now");
  if (minutes < 60) return translate(lang, "{count} min ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate(lang, "{count} hr ago", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return translate(lang, "{count} day ago", { count: days });
  return new Date(then).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-US");
}
