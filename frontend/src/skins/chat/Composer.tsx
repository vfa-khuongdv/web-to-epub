import { CirclePlus, Paperclip, SendHorizontal, Smile, Type } from "lucide-react";
import { KeyboardEvent, RefObject, useMemo, useState } from "react";
import { SlashCommand, draftAction, matchSlash, slashQuery } from "./slash";

const TOOL = "grid size-9 flex-none place-items-center rounded-full text-chat-dim";

/**
 * The rounded message box. "/" lists the slash commands (arrows pick, Tab completes,
 * Enter runs); plain text is handed to `onMessage`, which only shows it on this screen —
 * nothing typed here is sent or stored. Marked `data-boss-key`: nobody needs a backquote
 * in a chat line, so the boss key works from here without Alt.
 */
export function Composer({
  inputRef,
  placeholder,
  commands,
  onMessage,
  onUnknown,
  sendLabel,
}: {
  inputRef: RefObject<HTMLInputElement>;
  placeholder: string;
  commands: SlashCommand[];
  onMessage: (text: string) => void;
  onUnknown: (name: string) => void;
  sendLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(0);
  const query = slashQuery(draft);
  const shown = useMemo(() => (query === null ? [] : matchSlash(commands, query)), [commands, query]);
  const open = shown.length > 0;
  const current = shown[Math.min(active, shown.length - 1)];

  const submit = () => {
    const action = draftAction(draft, commands, current);
    if (action.kind === "none") return;
    setDraft("");
    setActive(0);
    if (action.kind === "run") action.command.run();
    else if (action.kind === "unknown") onUnknown(action.name);
    else onMessage(action.text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (open && (event.key === "ArrowDown" || event.key === "ArrowUp") && !event.altKey) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + shown.length) % shown.length);
    } else if (open && event.key === "Tab" && current) {
      event.preventDefault();
      setDraft(`/${current.name}`);
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape" && draft) {
      event.preventDefault();
      event.stopPropagation();
      setDraft("");
      setActive(0);
    }
  };

  return (
    <div className="relative flex-none px-3 pb-4 pt-1 sm:px-6">
      {open && (
        <ul
          id="chat-slash-list"
          role="listbox"
          aria-label="Commands"
          className="absolute bottom-full left-3 right-3 mb-1 max-h-[280px] overflow-y-auto rounded-2xl border border-chat-rule bg-chat-surface py-2 shadow-[0_4px_16px_rgba(0,0,0,0.16)] sm:left-6 sm:right-6"
        >
          {shown.map((command, index) => (
            <li
              key={command.name}
              id={`chat-slash-${command.name}`}
              role="option"
              aria-selected={command === current}
              className={`flex cursor-pointer items-baseline gap-3 px-4 py-2 text-[14px] ${
                command === current ? "bg-chat-active text-chat-active-fg" : "text-chat-fg"
              }`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                setDraft("");
                setActive(0);
                command.run();
              }}
            >
              <span className="w-24 flex-none font-medium">/{command.name}</span>
              <span className="min-w-0 truncate text-[13px] opacity-80">{command.description}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mx-auto flex max-w-[880px] items-center gap-1 rounded-[28px] bg-chat-composer py-1.5 pl-2 pr-1.5 focus-within:ring-1 focus-within:ring-chat-rule">
        <span className={TOOL} aria-hidden="true">
          <CirclePlus size={20} strokeWidth={1.8} />
        </span>
        <input
          ref={inputRef}
          data-boss-key=""
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? "chat-slash-list" : undefined}
          aria-activedescendant={open && current ? `chat-slash-${current.name}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          aria-label={placeholder}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-10 min-w-0 flex-1 bg-transparent px-2 text-[15px] text-chat-fg outline-none placeholder:text-chat-faint"
        />
        <span className={`${TOOL} max-sm:hidden`} aria-hidden="true">
          <Type size={19} strokeWidth={1.8} />
        </span>
        <span className={`${TOOL} max-sm:hidden`} aria-hidden="true">
          <Smile size={20} strokeWidth={1.8} />
        </span>
        <span className={`${TOOL} max-sm:hidden`} aria-hidden="true">
          <Paperclip size={19} strokeWidth={1.8} />
        </span>
        <button
          type="button"
          aria-label={sendLabel}
          title={sendLabel}
          disabled={!draft.trim()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={submit}
          className="grid size-9 flex-none place-items-center rounded-full text-chat-accent outline-none enabled:hover:bg-chat-accent-soft disabled:text-chat-faint focus-visible:ring-2 focus-visible:ring-chat-accent"
        >
          <SendHorizontal size={20} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
