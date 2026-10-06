import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { CrawlLogLine } from "../../hooks/useCrawlJob";
import { useLang } from "../../i18n";
import { COMMAND_NAMES, TerminalEntry, historyStep, interleave, parseCommand } from "./terminal";
import { logText } from "../../lib/skins/crawlLog";

export type ShellCommand = "crawl" | "stop" | "open" | "hide";
export type ShellOutput = { text: string; error?: boolean }[];

const HISTORY_LIMIT = 50;

function Prompt({ folder }: { folder: string }) {
  return (
    <span aria-hidden="true" className="select-none whitespace-pre">
      <span className="text-code-added">➜</span>
      {"  "}
      <span className="font-bold text-code-type">{folder}</span>{" "}
      <span className="text-code-keyword">git:(</span>
      <span className="text-code-error">main</span>
      <span className="text-code-keyword">)</span>{" "}
    </span>
  );
}

/**
 * The terminal: the open folder's crawl log as process output (chapter addresses turned
 * into file names), and a prompt for help / crawl / stop / open / clear / hide. Typed
 * lines keep their place among the log lines. Stays mounted while the panel is closed,
 * so what was typed is still there when it opens again.
 */
export function TerminalView({
  log,
  fileForUrl,
  folder,
  run,
  focusToken,
}: {
  log: CrawlLogLine[];
  fileForUrl: (url: string) => string | null;
  folder: string | null;
  run: (command: ShellCommand) => Promise<ShellOutput>;
  focusToken: number;
}) {
  const { t } = useLang();
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [clearedAt, setClearedAt] = useState<CrawlLogLine | null | undefined>(undefined);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(0);
  const nextId = useRef(0);
  const logRef = useRef(log);
  logRef.current = log;
  const field = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const items = useMemo(() => interleave(log, entries, clearedAt), [log, entries, clearedAt]);

  useEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [items]);

  useEffect(() => {
    if (focusToken > 0) field.current?.focus({ preventScroll: true });
  }, [focusToken]);

  const append = (lines: { kind: TerminalEntry["kind"]; text: string }[]) => {
    const current = logRef.current;
    const after = current[current.length - 1] ?? null;
    setEntries((list) => [...list, ...lines.map((line) => ({ ...line, id: ++nextId.current, after }))]);
  };

  const submit = async () => {
    const value = input;
    setInput("");
    stick.current = true;
    if (value.trim()) {
      const nextHistory = [...history, value].slice(-HISTORY_LIMIT);
      setHistory(nextHistory);
      setHistoryAt(nextHistory.length);
    }
    const { command, name } = parseCommand(value);
    if (command === "clear") {
      const current = logRef.current;
      setEntries([]);
      setClearedAt(current[current.length - 1] ?? null);
      return;
    }
    append([{ kind: "input", text: value }]);
    if (command === "empty") return;
    if (command === "help") {
      const describe: Record<(typeof COMMAND_NAMES)[number], string> = {
        help: t("Show this list"),
        crawl: t("Download the rest"),
        stop: t("Stop downloading"),
        open: t("Open in the normal view"),
        clear: t("Clear the terminal"),
        hide: t("Hide now"),
      };
      append(COMMAND_NAMES.map((cmd) => ({ kind: "output" as const, text: `  ${cmd.padEnd(8)}${describe[cmd]}` })));
      return;
    }
    if (command === "unknown") {
      append([
        { kind: "error", text: `zsh: command not found: ${name}` },
        { kind: "output", text: t('Type "help" to see the commands.') },
      ]);
      return;
    }
    const output = await run(command);
    append(output.map((line) => ({ kind: line.error ? ("error" as const) : ("output" as const), text: line.text })));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && history.length > 0) {
      event.preventDefault();
      const at = historyStep(history, historyAt, event.key === "ArrowUp" ? -1 : 1);
      setHistoryAt(at);
      setInput(history[at] ?? "");
    } else if (event.ctrlKey && !event.metaKey && !event.altKey && event.code === "KeyL") {
      event.preventDefault();
      const current = logRef.current;
      setEntries([]);
      setClearedAt(current[current.length - 1] ?? null);
    }
  };

  const shownFolder = folder ?? "workspace";
  return (
    <div
      ref={scroller}
      className="h-full overflow-y-auto px-5 py-1.5 outline-none focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-code-focus font-mono text-[13px] leading-[19px] text-code-text"
      onScroll={(event) => {
        const element = event.currentTarget;
        stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      }}
      onMouseUp={() => {
        if (window.getSelection()?.isCollapsed !== false) field.current?.focus({ preventScroll: true });
      }}
    >
      {items.length === 0 && <div className="text-code-dim">{t('Type "help" to see the commands.')}</div>}
      {items.map((item) =>
        item.type === "log" ? (
          <div key={`log-${item.index}-${item.line.at}`} className={`whitespace-pre-wrap break-words ${item.line.isError ? "text-code-error" : ""}`}>
            <span className="text-code-dim">{item.line.at}</span> {logText(item.line.text, fileForUrl)}
          </div>
        ) : (
          <div
            key={item.entry.id}
            className={`whitespace-pre-wrap break-words ${item.entry.kind === "error" ? "text-code-error" : ""}`}
          >
            {item.entry.kind === "input" && <Prompt folder={shownFolder} />}
            {item.entry.text}
          </div>
        )
      )}
      <div className="flex items-baseline">
        <Prompt folder={shownFolder} />
        <input
          ref={field}
          // The boss key still hides from here (lib/ui/stealth.ts isTextEntry).
          data-boss-key=""
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-code-text caret-code-text outline-none"
          aria-label={t("Terminal input")}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
