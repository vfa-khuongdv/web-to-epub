import { IconName } from "../components/Icon";

export type Theme = "system" | "light" | "dark";

const THEME_KEY = "theme";
// Click the header button to cycle: auto -> light -> dark -> auto.
export const THEME_CYCLE: Theme[] = ["system", "light", "dark"];
export const THEME_LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };
export const THEME_ICON: Record<Theme, IconName> = { system: "display", light: "sun", dark: "moon" };

// localStorage can throw (private window, cookies blocked): theme still switches, just
// won't be remembered on next open.
export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* Storage failed, but theme still changes for this session */
  }
}

export function applyTheme(theme: Theme): void {
  const dark = theme === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
