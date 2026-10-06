// The terminal window's own shortcuts, wherever focus is inside it: the command palette
// (F1, Ctrl/Cmd+Shift+P) and the font size (Ctrl/Cmd + = / - / 0, as terminal apps zoom).
// Letters are matched by physical key, so a Vietnamese input method does not move them.

export type WindowAction = "palette" | "zoomIn" | "zoomOut" | "zoomReset";

export type KeyInput = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

export function windowAction(event: KeyInput): WindowAction | null {
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === "F1") return mod || event.altKey ? null : "palette";
  if (!mod || event.altKey) return null;
  if (event.shiftKey && event.code === "KeyP") return "palette";
  if (event.code === "Equal" || event.key === "+" || event.code === "NumpadAdd") return "zoomIn";
  if (event.code === "Minus" || event.code === "NumpadSubtract") return "zoomOut";
  if (event.code === "Digit0" || event.code === "Numpad0") return event.shiftKey ? null : "zoomReset";
  return null;
}

export const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 22];
export const DEFAULT_FONT_SIZE = 14;

export function stepFontSize(size: number, step: 1 | -1): number {
  const at = FONT_SIZES.indexOf(size);
  const from = at >= 0 ? at : FONT_SIZES.indexOf(DEFAULT_FONT_SIZE);
  return FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, from + step))];
}

// The window's font size is the viewer's own (localStorage), read by the shell and by the
// decoy alike, so both lay out the same cells and report the same size.
export const FONT_KEY = "term-font-size";

export function readFontSize(): number {
  try {
    const saved = Number(localStorage.getItem(FONT_KEY));
    return FONT_SIZES.includes(saved) ? saved : DEFAULT_FONT_SIZE;
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}
