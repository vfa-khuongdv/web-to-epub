import { RefObject, useEffect, useRef } from "react";

/**
 * The keys that work anywhere in the skin, as in the program it looks like: F1 and Alt+Q
 * open the search box's command list, Ctrl/Cmd+PageDown/PageUp step between sheets.
 * Ctrl/Cmd+F stays the browser's own find. Not
 * while focus is outside the skin (the settings) or the decoy covers it, and never a key
 * something else already handled.
 */
export function useProgramKeys(
  root: RefObject<HTMLElement | null>,
  actions: { openPalette: () => void; stepSheet: (delta: 1 | -1) => void }
) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("[data-stealth-decoy]")) return;
      const target = event.target instanceof Node ? event.target : null;
      const inside = !target || target === document.body || !!root.current?.contains(target);
      if (!inside) return;
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === "F1" || (event.altKey && !mod && event.code === "KeyQ")) {
        event.preventDefault();
        latest.current.openPalette();
      } else if (mod && (event.key === "PageDown" || event.key === "PageUp")) {
        event.preventDefault();
        latest.current.stepSheet(event.key === "PageDown" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root]);
}
