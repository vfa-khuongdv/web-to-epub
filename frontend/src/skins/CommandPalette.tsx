import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { slugify } from "../lib/skins/slug";

export interface PaletteCommand {
  id: string;
  label: string;
  // Right-hand text: a shortcut, or where the command leads.
  hint?: string;
  // Listed only once something is typed: an entry that would give the disguise away to
  // anyone glancing at the open list ("Switch look: Spreadsheet") stays out of it.
  searchOnly?: boolean;
  run: () => void;
}

// Matches every word of the query in the label, ignoring case and Vietnamese diacritics
// ("mo o giao dien" finds "Mở ở giao diện thường"). An empty query lists all but the
// search-only commands.
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const words = slugify(query, 200).split("-").filter(Boolean);
  if (words.length === 0) return commands.filter((command) => !command.searchOnly);
  return commands.filter((command) => {
    const haystack = slugify(`${command.label} ${command.hint ?? ""}`, 400);
    return words.every((word) => haystack.includes(word));
  });
}

// Each program opens its command list its own way: where it sits, its frame, the field
// and how the chosen row is marked. Shared sizes are spelled out per tone, so a tone can
// be square and dense (the editor) or round and airy (the chat).
const TONES = {
  code: {
    // Under the title bar, centred, like the editor's command palette.
    place: "left-1/2 top-[34px] w-[min(600px,calc(100vw-32px))] -translate-x-1/2",
    frame: "border border-code-border bg-code-side p-1.5 text-code-fg shadow-[0_0_8px_2px_rgba(0,0,0,0.36)]",
    input: "border border-code-focus bg-code-input px-2 py-1 text-[13px] text-code-text",
    list: "mt-1 max-h-[320px]",
    row: "px-2 py-[3px] text-[13px]",
    idle: "text-code-fg",
    active: "bg-code-active text-code-text",
    hint: "text-[12px] text-code-dim",
  },
  sheet: {
    // A drop-down under the title bar's search box, as the spreadsheet's search opens.
    place: "left-1/2 top-[30px] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 rounded-[4px]",
    frame: "border border-sheet-rule bg-sheet-cell p-1.5 font-sheet text-sheet-fg shadow-[0_4px_16px_rgba(0,0,0,0.22)]",
    input: "border border-sheet-select bg-sheet-cell px-2 py-1 text-[13px] text-sheet-fg",
    list: "mt-1 max-h-[320px]",
    row: "px-2 py-[3px] text-[13px]",
    idle: "text-sheet-fg",
    active: "bg-sheet-select-soft text-sheet-fg",
    hint: "text-[12px] text-sheet-dim",
  },
  chat: {
    // Drops from the top bar's search box (after the menu button and the name on a wide
    // window, centred on a narrow one), rounded like it.
    place:
      "left-1/2 top-[60px] w-[min(720px,calc(100vw-24px))] -translate-x-1/2 lg:left-[264px] lg:w-[min(720px,calc(100vw-280px))] lg:translate-x-0",
    frame:
      "rounded-[24px] border border-chat-rule bg-chat-surface p-2 font-chat text-chat-fg shadow-[0_6px_24px_rgba(0,0,0,0.16)]",
    input:
      "h-11 rounded-full border border-transparent bg-chat-search px-4 text-[15px] text-chat-fg placeholder:text-chat-faint focus:border-chat-accent",
    list: "mt-2 max-h-[min(420px,60vh)]",
    row: "rounded-full px-4 py-2 text-[14px]",
    idle: "text-chat-fg",
    active: "bg-chat-active text-chat-active-fg",
    hint: "text-[12.5px] text-chat-faint",
  },
  term: {
    // Under the title bar, centred, in the window's own monospace.
    place: "left-1/2 top-[40px] w-[min(600px,calc(100vw-32px))] -translate-x-1/2",
    frame:
      "rounded-[8px] border border-term-rule bg-term-bar p-1.5 font-term text-term-fg shadow-[0_8px_28px_rgba(0,0,0,0.32)]",
    input: "rounded-[5px] border border-term-rule bg-term-bg px-2 py-1 text-[13px] text-term-fg focus:border-term-blue",
    list: "mt-1.5 max-h-[340px]",
    row: "rounded-[4px] px-2 py-[3px] text-[13px]",
    idle: "text-term-fg",
    active: "bg-term-select text-term-fg",
    hint: "text-[12px] text-term-dim",
  },
  repo: {
    // A wide dialog high on the page with a borderless field over the results, as the
    // code-hosting site's command palette opens.
    place: "left-1/2 top-[10vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2",
    frame:
      "overflow-hidden rounded-[12px] border border-repo-border bg-repo-overlay font-repo text-repo-fg shadow-[0_12px_32px_rgba(31,35,40,0.2)]",
    input: "border-b border-repo-border-muted bg-repo-overlay px-4 py-3 text-[14px] text-repo-fg placeholder:text-repo-muted",
    list: "max-h-[min(440px,60vh)] p-2",
    row: "rounded-[6px] border-l-2 px-3 py-[7px] text-[14px]",
    idle: "border-transparent text-repo-fg",
    active: "border-repo-accent bg-repo-hover text-repo-fg",
    hint: "text-[12px] text-repo-muted",
  },
} as const;

export type PaletteTone = keyof typeof TONES;

/**
 * The skins' way to everything they do not draw themselves (settings, the default view,
 * crawl, the boss key): a filterable command list, opened with F1 or Ctrl/Cmd+Shift+P in
 * the code skin and from the search box in both. Keys it handles are marked handled, so
 * the narration player's global shortcuts (Space, arrows) do not also fire. Commands
 * marked `searchOnly` appear only once something is typed.
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
  tone: PaletteTone;
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
        className={`fixed z-50 ${styles.place} ${styles.frame}`}
        role="dialog"
        aria-label={placeholder}
      >
        <input
          ref={input}
          // The boss key still hides from here (lib/ui/stealth.ts isTextEntry).
          data-boss-key=""
          className={`w-full outline-none ${styles.input}`}
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
        <ul ref={list} id="skin-palette-list" role="listbox" className={`overflow-y-auto ${styles.list}`}>
          {shown.map((command, index) => (
            <li
              key={command.id}
              id={`skin-palette-${command.id}`}
              data-index={index}
              role="option"
              aria-selected={index === active}
              className={`flex cursor-pointer items-center justify-between gap-4 ${styles.row} ${
                index === active ? styles.active : styles.idle
              }`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                run(command);
              }}
            >
              <span className="truncate">{command.label}</span>
              {command.hint && <span className={`flex-none ${styles.hint}`}>{command.hint}</span>}
            </li>
          ))}
          {shown.length === 0 && <li className={`${styles.row} ${styles.hint}`}>No matching commands</li>}
        </ul>
      </div>
    </>
  );
}
