import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { slugify } from "../lib/skins/slug";

export interface PaletteCommand {
  id: string;
  label: string;
  // Right-hand text: a shortcut, or where the command leads.
  hint?: string;
  run: () => void;
}

// Matches every word of the query in the label, ignoring case and Vietnamese diacritics
// ("mo o giao dien" finds "Mở ở giao diện thường").
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const words = slugify(query, 200).split("-").filter(Boolean);
  if (words.length === 0) return commands;
  return commands.filter((command) => {
    const haystack = slugify(`${command.label} ${command.hint ?? ""}`, 400);
    return words.every((word) => haystack.includes(word));
  });
}

const TONES = {
  code: {
    // Under the title bar, centred, like the editor's command palette.
    place: "top-[34px] w-[min(600px,calc(100vw-32px))]",
    frame: "border-code-border bg-code-side text-code-fg shadow-[0_0_8px_2px_rgba(0,0,0,0.36)]",
    input: "border-code-focus bg-code-input text-code-text",
    item: "text-code-fg",
    active: "bg-code-active text-code-text",
    hint: "text-code-dim",
  },
  sheet: {
    // A drop-down under the title bar's search box, as the spreadsheet's search opens.
    place: "top-[30px] w-[min(480px,calc(100vw-32px))] rounded-[4px]",
    frame: "border-sheet-rule bg-sheet-cell text-sheet-fg shadow-[0_4px_16px_rgba(0,0,0,0.22)] font-sheet",
    input: "border-sheet-select bg-sheet-cell text-sheet-fg",
    item: "text-sheet-fg",
    active: "bg-sheet-select-soft text-sheet-fg",
    hint: "text-sheet-dim",
  },
} as const;

/**
 * The skins' way to everything they do not draw themselves (settings, the default view,
 * crawl, the boss key): a filterable command list, opened with F1 or Ctrl/Cmd+Shift+P in
 * the code skin and from the search box in both. Keys it handles are marked handled, so
 * the narration player's global shortcuts (Space, arrows) do not also fire.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder,
  tone,
}: {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  placeholder: string;
  tone: keyof typeof TONES;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => filterCommands(commands, query), [commands, query]);
  const styles = TONES[tone];

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    input.current?.focus();
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (command: PaletteCommand | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(shown.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(shown[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" onMouseDown={onClose} />
      <div
        className={`fixed left-1/2 z-50 -translate-x-1/2 border p-1.5 ${styles.place} ${styles.frame}`}
        role="dialog"
        aria-label={placeholder}
      >
        <input
          ref={input}
          // The boss key still hides from here (lib/ui/stealth.ts isTextEntry).
          data-boss-key=""
          className={`w-full border px-2 py-1 text-[13px] outline-none ${styles.input}`}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-controls="skin-palette-list"
          aria-activedescendant={shown[active] ? `skin-palette-${shown[active].id}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul ref={list} id="skin-palette-list" role="listbox" className="mt-1 max-h-[320px] overflow-y-auto">
          {shown.map((command, index) => (
            <li
              key={command.id}
              id={`skin-palette-${command.id}`}
              data-index={index}
              role="option"
              aria-selected={index === active}
              className={`flex cursor-pointer items-center justify-between gap-4 px-2 py-[3px] text-[13px] ${
                index === active ? styles.active : styles.item
              }`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                run(command);
              }}
            >
              <span className="truncate">{command.label}</span>
              {command.hint && <span className={`flex-none text-[12px] ${styles.hint}`}>{command.hint}</span>}
            </li>
          ))}
          {shown.length === 0 && <li className={`px-2 py-1 text-[13px] ${styles.hint}`}>No matching commands</li>}
        </ul>
      </div>
    </>
  );
}
