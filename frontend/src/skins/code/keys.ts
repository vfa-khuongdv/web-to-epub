// The code skin's window-wide shortcuts, as the real editor binds them. Ctrl and Cmd are
// both accepted (Ctrl/Cmd+B), so the same keys work on every platform and in Electron.

export type GlobalAction =
  | "palette"
  | "quickOpen"
  | "toggleSidebar"
  | "togglePanel"
  | "closeTab"
  | "showExplorer"
  | "showSearch";

export type KeyInput = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

// Letters are matched by physical key (`code`), so a Vietnamese input method or another
// layout does not move them; `key` is the fallback for a keyboard that reports no code.
function letter(event: KeyInput): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  return event.key.length === 1 ? event.key.toLowerCase() : "";
}

export function globalAction(event: KeyInput): GlobalAction | null {
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === "F1") return mod || event.altKey ? null : "palette";
  if (!mod || event.altKey) return null;
  // Ctrl+` (never Cmd: that switches windows on a Mac). Backquote without Ctrl or Cmd is
  // the boss key, handled by the stealth layer before anything here sees it.
  if (event.code === "Backquote") return event.ctrlKey && !event.shiftKey ? "togglePanel" : null;
  const key = letter(event);
  if (event.shiftKey) {
    if (key === "p") return "palette";
    if (key === "e") return "showExplorer";
    if (key === "f") return "showSearch";
    return null;
  }
  switch (key) {
    case "p":
      return "quickOpen";
    case "b":
      return "toggleSidebar";
    case "j":
      return "togglePanel";
    case "w":
      return "closeTab";
    default:
      return null;
  }
}

export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");

// "Mod+Shift+P" → "⇧⌘P" on a Mac, "Ctrl+Shift+P" elsewhere — how the editor prints them.
export function shortcut(keys: string, mac = IS_MAC): string {
  const parts = keys.split("+");
  if (!mac) return parts.map((part) => (part === "Mod" ? "Ctrl" : part)).join("+");
  const symbol: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Shift: "⇧", Alt: "⌥" };
  const modifiers = parts.slice(0, -1).map((part) => symbol[part] ?? part);
  // The Mac order is ⌃⌥⇧⌘.
  const rank = ["⌃", "⌥", "⇧", "⌘"];
  modifiers.sort((a, b) => rank.indexOf(a) - rank.indexOf(b));
  return modifiers.join("") + parts[parts.length - 1];
}
