import { Columns2, Ellipsis, X } from "lucide-react";
import { KeyboardEvent, MouseEvent, useEffect, useRef } from "react";
import { MarkdownGlyph } from "./ExplorerTree";

export interface TabView {
  key: string;
  name: string;
}

export const WELCOME_KEY = "welcome";

/**
 * The strip of open editors. A click shows a tab, × or a middle click closes it;
 * with a tab focused, Left/Right/Home/End move between tabs and Delete closes one.
 * The close glyph is out of the accessibility tree, so a tab's name is its file name.
 */
export function EditorTabs({
  tabs,
  activeKey,
  onActivate,
  onClose,
}: {
  tabs: TabView[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}) {
  const elements = useRef(new Map<string, HTMLDivElement>());
  const follow = useRef(false);
  const shown: TabView[] = tabs.length > 0 ? tabs : [{ key: WELCOME_KEY, name: "Welcome" }];
  const current = tabs.length > 0 ? activeKey : WELCOME_KEY;

  useEffect(() => {
    if (!current) return;
    const element = elements.current.get(current);
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (follow.current) {
      follow.current = false;
      element?.focus();
    }
  }, [current]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const at = shown.findIndex((tab) => tab.key === current);
    let next: TabView | undefined;
    switch (event.key) {
      case "ArrowRight":
        next = shown[Math.min(shown.length - 1, at + 1)];
        break;
      case "ArrowLeft":
        next = shown[Math.max(0, at - 1)];
        break;
      case "Home":
        next = shown[0];
        break;
      case "End":
        next = shown[shown.length - 1];
        break;
      case "Delete":
        if (current && current !== WELCOME_KEY) onClose(current);
        event.preventDefault();
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        return;
      default:
        return;
    }
    event.preventDefault();
    if (next && next.key !== current && next.key !== WELCOME_KEY) {
      follow.current = true;
      onActivate(next.key);
    }
  };

  const onMouseDown = (event: MouseEvent) => {
    // A middle click would start the browser's autoscroll.
    if (event.button === 1) event.preventDefault();
  };

  return (
    <div className="flex h-[35px] flex-none bg-code-tab">
      <div
        role="tablist"
        aria-label="Open editors"
        className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
        onKeyDown={onKeyDown}
      >
        {shown.map((tab) => {
          const active = tab.key === current;
          const welcome = tab.key === WELCOME_KEY;
          return (
            <div
              key={tab.key}
              ref={(element) => {
                if (element) elements.current.set(tab.key, element);
                else elements.current.delete(tab.key);
              }}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={welcome ? undefined : tab.name}
              className={`group flex h-full min-w-[80px] max-w-[240px] flex-none cursor-pointer select-none items-center border-r border-code-border pl-2.5 pr-1 text-[13px] outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-focus ${
                active ? "bg-code-tab-active text-code-text" : "text-code-dim hover:text-code-fg"
              }`}
              onClick={() => !welcome && onActivate(tab.key)}
              onMouseDown={onMouseDown}
              onAuxClick={(event) => {
                if (event.button === 1 && !welcome) onClose(tab.key);
              }}
            >
              {welcome ? (
                <span className="w-4 flex-none text-center text-[12px] text-code-focus" aria-hidden="true">
                  ≡
                </span>
              ) : (
                <MarkdownGlyph />
              )}
              <span className={`ml-1.5 min-w-0 truncate ${welcome ? "italic" : ""}`}>{tab.name}</span>
              <span
                aria-hidden="true"
                className={`ml-1 grid size-5 flex-none place-items-center rounded-[4px] hover:bg-code-hover ${
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                } ${welcome ? "invisible" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!welcome) onClose(tab.key);
                }}
              >
                <X size={14} />
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-none items-center gap-0.5 px-2 text-code-fg" aria-hidden="true">
        <span className="grid size-[22px] place-items-center">
          <Columns2 size={15} />
        </span>
        <span className="grid size-[22px] place-items-center">
          <Ellipsis size={16} />
        </span>
      </div>
    </div>
  );
}
