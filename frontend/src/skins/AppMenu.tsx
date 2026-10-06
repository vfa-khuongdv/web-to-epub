import { Check } from "lucide-react";
import { KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuEntry =
  | { kind: "item"; id: string; label: string; hint?: string; checked?: boolean; run: () => void }
  | { kind: "separator"; id: string }
  | { kind: "heading"; id: string; label: string };

// Where the menu opens: under (or above) the control that opened it, at its left edge.
export interface MenuAnchor {
  x: number;
  y: number;
  placement: "below" | "above";
}

export function anchorFor(element: Element, placement: MenuAnchor["placement"] = "below"): MenuAnchor {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: placement === "below" ? box.bottom + 2 : box.top - 2, placement };
}

const TONES = {
  // Each program draws its menus its own way; the normal view keeps the app's flat look.
  code: {
    frame: "min-w-[240px] rounded-[5px] border border-code-border bg-code-editor py-1 text-code-fg shadow-[0_2px_8px_rgba(0,0,0,0.36)]",
    item: "mx-1 rounded-[3px] px-2 py-[3px]",
    active: "bg-code-focus text-white",
    hint: "text-current opacity-70",
    heading: "px-3 pt-1 pb-0.5 text-[11px] uppercase tracking-wide text-code-dim",
    separator: "mx-2 my-1 h-px bg-code-border",
  },
  sheet: {
    frame: "min-w-[240px] rounded-[4px] border border-sheet-rule bg-sheet-cell py-1 font-sheet text-sheet-fg shadow-[0_4px_16px_rgba(0,0,0,0.22)]",
    item: "px-3 py-[5px]",
    active: "bg-sheet-hover",
    hint: "text-sheet-dim",
    heading: "px-3 pt-1.5 pb-0.5 text-[11px] font-semibold text-sheet-dim",
    separator: "my-1 h-px bg-sheet-rule",
  },
  chat: {
    frame:
      "min-w-[248px] rounded-2xl border border-chat-rule bg-chat-surface py-2 font-chat text-chat-fg shadow-[0_6px_24px_rgba(0,0,0,0.16)]",
    item: "px-4 py-2 text-[14px]",
    active: "bg-chat-active text-chat-active-fg",
    hint: "text-chat-faint",
    heading: "px-4 pt-2 pb-1 text-[12px] font-medium text-chat-dim",
    separator: "my-1.5 h-px bg-chat-rule",
  },
  term: {
    frame:
      "min-w-[240px] rounded-[7px] border border-term-rule bg-term-bar py-1 font-term text-term-fg shadow-[0_6px_20px_rgba(0,0,0,0.3)]",
    item: "mx-1 rounded-[4px] px-2 py-[3px]",
    active: "bg-term-select text-term-fg",
    hint: "text-term-dim",
    heading: "px-3 pt-1 pb-0.5 text-[11px] text-term-dim",
    separator: "mx-2 my-1 h-px bg-term-rule",
  },
  repo: {
    frame:
      "min-w-[240px] rounded-[12px] border border-repo-border bg-repo-overlay py-2 font-repo text-repo-fg shadow-[0_8px_24px_rgba(31,35,40,0.16)]",
    item: "mx-2 rounded-[6px] px-2 py-[6px] text-[14px]",
    active: "bg-repo-hover",
    hint: "text-repo-muted",
    heading: "px-4 pt-1.5 pb-1 text-[12px] font-semibold text-repo-muted",
    separator: "my-2 h-px bg-repo-border-muted",
  },
  app: {
    frame: "min-w-[220px] rounded-tool border border-rule-2 bg-raised py-1 text-ink",
    item: "px-2.5 py-[4px]",
    active: "bg-select text-on-select",
    hint: "text-current opacity-70",
    heading: "px-2.5 pt-1 pb-0.5 text-[10.5px] font-[650] uppercase tracking-[0.07em] text-ink-2",
    separator: "my-1 h-px bg-rule",
  },
} as const;

export type MenuTone = keyof typeof TONES;

/**
 * A drop-down menu of real actions (open the normal view, switch look, settings, hide),
 * drawn the way the program a skin imitates draws its menus. Arrow keys move, Enter or
 * Space runs, Escape or a click outside closes. Handled keys are marked handled, so the
 * narration player's shortcuts do not also fire.
 */
export function AppMenu({
  anchor,
  entries,
  onClose,
  tone,
  label,
}: {
  anchor: MenuAnchor | null;
  entries: MenuEntry[];
  onClose: () => void;
  tone: MenuTone;
  label: string;
}) {
  const styles = TONES[tone];
  const menu = useRef<HTMLDivElement>(null);
  const items = entries.filter((entry): entry is Extract<MenuEntry, { kind: "item" }> => entry.kind === "item");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  useEffect(() => {
    if (anchor) setActive(0);
  }, [anchor]);

  // Escape closes the menu even when something underneath took focus back (a skin that
  // refocuses its grid or editor), as a real menu does.
  useEffect(() => {
    if (!anchor) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [anchor, onClose]);

  // Kept on screen: a menu opened near the right or bottom edge moves in.
  useLayoutEffect(() => {
    if (!anchor || !menu.current) return;
    const width = menu.current.offsetWidth;
    const left = Math.max(8, Math.min(anchor.x, window.innerWidth - width - 8));
    setPosition(anchor.placement === "below" ? { left, top: anchor.y } : { left, bottom: window.innerHeight - anchor.y });
  }, [anchor]);

  // Focus once placed: until then the menu is `invisible`, and a hidden element cannot take
  // focus (the keys would stay with whatever opened it).
  useEffect(() => {
    if (anchor && position) menu.current?.focus({ preventScroll: true });
  }, [anchor, position]);

  useEffect(() => {
    if (!anchor) setPosition(null);
  }, [anchor]);

  if (!anchor) return null;

  const run = (index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") setActive((index) => (index + 1) % items.length);
    else if (event.key === "ArrowUp") setActive((index) => (index - 1 + items.length) % items.length);
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(items.length - 1);
    else if (event.key === "Enter" || event.key === " ") run(active);
    else if (event.key === "Escape" || event.key === "Tab") {
      event.stopPropagation();
      onClose();
    } else return;
    event.preventDefault();
  };

  let index = -1;
  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" onMouseDown={onClose} />
      <div
        ref={menu}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        aria-activedescendant={items[active] ? `app-menu-${items[active].id}` : undefined}
        onKeyDown={onKeyDown}
        className={`fixed z-50 text-[13px] outline-none ${styles.frame} ${position ? "" : "invisible"}`}
        style={position ?? { left: anchor.x, top: anchor.y }}
      >
        {entries.map((entry) => {
          if (entry.kind === "separator") return <div key={entry.id} role="separator" className={styles.separator} />;
          if (entry.kind === "heading")
            return (
              <div key={entry.id} role="presentation" className={styles.heading}>
                {entry.label}
              </div>
            );
          index += 1;
          const at = index;
          const radio = entry.checked !== undefined;
          return (
            <div
              key={entry.id}
              id={`app-menu-${entry.id}`}
              role={radio ? "menuitemradio" : "menuitem"}
              aria-checked={radio ? entry.checked : undefined}
              className={`flex cursor-pointer items-center gap-2 whitespace-nowrap ${styles.item} ${
                at === active ? styles.active : ""
              }`}
              onMouseEnter={() => setActive(at)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(at)}
            >
              <span className="grid w-4 flex-none place-items-center" aria-hidden="true">
                {entry.checked && <Check size={13} />}
              </span>
              <span className="flex-1">{entry.label}</span>
              {entry.hint && <span className={`ml-6 text-[12px] ${styles.hint}`}>{entry.hint}</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}
