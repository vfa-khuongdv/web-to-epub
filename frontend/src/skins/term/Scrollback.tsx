import { KeyboardEvent, RefObject, memo } from "react";
import { OutLine } from "./commands";
import { NameTone } from "./format";
import { PromptText } from "./TermChrome";

// One line of the scrollback: a prompt with what was typed at it, or output.
export interface ScrollLine {
  id: number;
  prompt?: { path: string; input: string };
  line?: OutLine;
}

const TONE: Record<NameTone, string> = {
  dir: "font-bold text-term-blue",
  file: "",
  pending: "text-term-dim",
  error: "text-term-red",
};

const TEXT_TONE = {
  error: "text-term-red",
  dim: "text-term-dim",
  accent: "text-term-cyan",
} as const;

function Output({ line }: { line: OutLine }) {
  if (line.kind === "grid") {
    return (
      <div className="whitespace-pre">
        {line.cells.map((cell, index) => (
          <span key={index}>
            <span className={TONE[cell.tone]}>{cell.name}</span>
            {cell.pad > 0 ? " ".repeat(cell.pad) : ""}
          </span>
        ))}
      </div>
    );
  }
  if (line.kind === "long") {
    return (
      <div className="whitespace-pre">
        {line.row.meta} <span className={TONE[line.row.tone]}>{line.row.name}</span>
      </div>
    );
  }
  return (
    <div className={`min-h-[1lh] whitespace-pre-wrap break-words ${line.tone ? TEXT_TONE[line.tone] : ""}`}>{line.text}</div>
  );
}

/**
 * Everything printed so far. Memoized apart from the prompt being typed at, so a
 * keystroke does not redraw thousands of lines of output.
 */
export const Scrollback = memo(function Scrollback({ lines }: { lines: ScrollLine[] }) {
  return (
    <>
      {lines.map((entry) =>
        entry.prompt ? (
          <div key={entry.id} className="whitespace-pre-wrap break-all">
            <PromptText path={entry.prompt.path} />
            {entry.prompt.input}
          </div>
        ) : entry.line ? (
          <Output key={entry.id} line={entry.line} />
        ) : null
      )}
    </>
  );
});

/**
 * The line being typed: the prompt, the text with a block caret drawn over the character
 * at the cursor (hollow while the window is not focused), and a right-hand prompt. The
 * real <input> lies invisible over it, so typing, IME composition, paste and the phone's
 * keyboard all work; it carries data-boss-key, so a plain backquote still hides.
 */
export function PromptLine({
  path,
  value,
  caret,
  focused,
  showPrompt,
  right,
  label,
  inputRef,
  onChange,
  onCaret,
  onKeyDown,
  onFocusChange,
}: {
  path: string;
  value: string;
  caret: number;
  focused: boolean;
  // Hidden while a program runs in the foreground (typed keys wait, as in a real shell).
  showPrompt: boolean;
  right: string | null;
  label: string;
  inputRef: RefObject<HTMLInputElement>;
  onChange: (value: string, caret: number) => void;
  onCaret: (caret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onFocusChange: (focused: boolean) => void;
}) {
  const at = Math.min(caret, value.length);
  const cursor = (
    <span
      className={
        focused ? "bg-term-caret text-term-bg" : "outline outline-1 -outline-offset-1 outline-term-caret"
      }
    >
      {value[at] ?? " "}
    </span>
  );
  return (
    <div className="relative flex items-start">
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-all">
        {showPrompt && <PromptText path={path} />}
        {showPrompt ? value.slice(0, at) : null}
        {cursor}
        {showPrompt ? value.slice(at + 1) : null}
      </div>
      {right && showPrompt && <span className="ml-4 flex-none whitespace-pre text-term-dim max-[520px]:hidden">{right}</span>}
      <input
        ref={inputRef}
        // The boss key still hides from here (lib/ui/stealth.ts isTextEntry).
        data-boss-key=""
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-[16px] opacity-0 outline-none"
        aria-label={label}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
        onSelect={(event) => onCaret(event.currentTarget.selectionStart ?? value.length)}
        // The invisible text does not sit where the visible one is drawn: a click leaves the
        // cursor at the end, as a click in a terminal does not move it either.
        onPointerUp={(event) => {
          const field = event.currentTarget;
          field.setSelectionRange(field.value.length, field.value.length);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
      />
    </div>
  );
}
