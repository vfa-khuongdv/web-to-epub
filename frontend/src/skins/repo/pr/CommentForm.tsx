// The site's comment box: Write / Preview tabs, the formatting toolbar (it really wraps
// the selection), a textarea, the "Markdown is supported" footer and the caller's
// buttons. Ctrl/Cmd+Enter runs the main button, Escape cancels when there is a cancel.
// Whatever is typed stays on the page: nothing is sent anywhere.

import { AtSign, Bold, Code, FileText, Hash, Heading, Italic, Link, List, ListChecks, ListOrdered, TextQuote } from "lucide-react";
import { KeyboardEvent, ReactNode, useEffect, useId, useRef, useState } from "react";
import { FOCUS } from "../RepoChrome";
import { Markdown } from "./ui";

export interface FormApi {
  text: string;
  reset: () => void;
}

type Format = { label: string; icon: ReactNode; before: string; after?: string; line?: boolean };

const FORMATS: Format[][] = [
  [
    { label: "Heading", icon: <Heading size={16} />, before: "### ", line: true },
    { label: "Bold", icon: <Bold size={16} />, before: "**", after: "**" },
    { label: "Italic", icon: <Italic size={16} />, before: "_", after: "_" },
  ],
  [
    { label: "Quote", icon: <TextQuote size={16} />, before: "> ", line: true },
    { label: "Code", icon: <Code size={16} />, before: "`", after: "`" },
    { label: "Link", icon: <Link size={16} />, before: "[", after: "](url)" },
  ],
  [
    { label: "Numbered list", icon: <ListOrdered size={16} />, before: "1. ", line: true },
    { label: "Unordered list", icon: <List size={16} />, before: "- ", line: true },
    { label: "Task list", icon: <ListChecks size={16} />, before: "- [ ] ", line: true },
  ],
  [
    { label: "Mention", icon: <AtSign size={16} />, before: "@" },
    { label: "Reference", icon: <Hash size={16} />, before: "#" },
  ],
];

export function CommentForm({
  label,
  placeholder = "Add your comment here...",
  autoFocus = false,
  minHeight = 100,
  actions,
  onSubmit,
  onCancel,
  initial = "",
  framed = true,
}: {
  // The textarea's accessible name.
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  minHeight?: number;
  // The buttons under the box, given the text so far.
  actions: (form: FormApi) => ReactNode;
  // Ctrl/Cmd+Enter.
  onSubmit?: (form: FormApi) => void;
  onCancel?: () => void;
  initial?: string;
  // Drawn with its own border (inline forms); without it the caller's box is the frame.
  framed?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const area = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  useEffect(() => {
    if (autoFocus) area.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const form: FormApi = { text, reset: () => setText("") };

  const apply = (format: Format) => {
    const field = area.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const selected = text.slice(start, end);
    let next: string;
    let caret: number;
    if (format.line) {
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      next = text.slice(0, lineStart) + format.before + text.slice(lineStart);
      caret = end + format.before.length;
    } else {
      next = text.slice(0, start) + format.before + selected + (format.after ?? "") + text.slice(end);
      caret = start + format.before.length + selected.length;
    }
    setText(next);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && onSubmit) {
      event.preventDefault();
      if (text.trim()) onSubmit(form);
    } else if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  const tabClass = (value: "write" | "preview") =>
    `-mb-px h-10 rounded-t-md border px-4 text-[14px] ${FOCUS} ${
      tab === value ? "border-repo-border border-b-repo-canvas bg-repo-canvas text-repo-fg" : "border-transparent text-repo-muted hover:text-repo-fg"
    }`;

  return (
    <div className={framed ? "rounded-md border border-repo-border bg-repo-canvas" : ""}>
      <div className={`flex items-end gap-2 border-b border-repo-border bg-repo-subtle px-2 pt-2 ${framed ? "rounded-t-md" : ""}`}>
        <div role="tablist" aria-label="Comment" className="flex">
          <button type="button" role="tab" aria-selected={tab === "write"} className={tabClass("write")} onClick={() => setTab("write")}>
            Write
          </button>
          <button type="button" role="tab" aria-selected={tab === "preview"} className={tabClass("preview")} onClick={() => setTab("preview")}>
            Preview
          </button>
        </div>
        {tab === "write" && (
          <div role="toolbar" aria-label="Formatting tools" className="ml-auto hidden items-center pb-1.5 md:flex">
            {FORMATS.map((group, index) => (
              <span key={index} className="flex items-center border-l border-repo-border-muted pl-1 first:border-0">
                {group.map((format) => (
                  <button
                    key={format.label}
                    type="button"
                    aria-label={format.label}
                    title={format.label}
                    onClick={() => apply(format)}
                    className={`grid size-7 place-items-center rounded-md text-repo-muted hover:bg-repo-btn-hover hover:text-repo-accent ${FOCUS}`}
                  >
                    {format.icon}
                  </button>
                ))}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="p-2">
        {tab === "write" ? (
          <textarea
            ref={area}
            id={id}
            aria-label={label}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            style={{ minHeight }}
            className="block max-h-[480px] w-full resize-y rounded-md border border-repo-border bg-repo-subtle p-2 text-[14px] leading-[1.5] text-repo-fg placeholder:text-repo-muted focus:border-repo-focus focus:bg-repo-canvas focus:outline-2 focus:outline-offset-[-1px] focus:outline-repo-focus"
          />
        ) : (
          <div className="min-h-[100px] border-b border-repo-border-muted px-2 py-2" aria-label="Preview">
            {text.trim() ? <Markdown source={text} /> : <p className="text-[14px] text-repo-muted">Nothing to preview</p>}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2 px-1 text-[12px] text-repo-muted">
          <span className="flex items-center gap-1">
            <FileText size={14} aria-hidden="true" />
            Markdown is supported
          </span>
          <span className="hidden sm:inline">Paste, drop, or click to add files</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 px-2 pb-2">{actions(form)}</div>
    </div>
  );
}
