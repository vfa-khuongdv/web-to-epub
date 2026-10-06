// The code-hosting site's building blocks, shared by the shell and its decoy: buttons,
// labels, status icons, avatars, pagination, banners and the global header. Generic
// glyphs only — the header's mark is a plain hexagon, never another product's logo.
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  GitPullRequest,
  Hexagon,
  Inbox,
  LoaderCircle,
  Menu,
  Plus,
  Search,
  X,
} from "lucide-react";
import { ReactNode, forwardRef } from "react";
import { identicon } from "./identicon";
import { PageItem, pageItems } from "./repoModel";

const FOCUS = "outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-repo-focus";

export const BTN = `inline-flex h-8 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-repo-border bg-repo-btn px-3 text-[14px] font-medium text-repo-fg hover:bg-repo-btn-hover disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const BTN_SM = `inline-flex h-7 flex-none items-center justify-center gap-1 whitespace-nowrap rounded-md border border-repo-border bg-repo-btn px-2 text-[12px] font-medium text-repo-fg hover:bg-repo-btn-hover disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const BTN_PRIMARY = `inline-flex h-8 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-black/15 bg-repo-success-btn px-3 text-[14px] font-medium text-white hover:bg-repo-success-btn-hover ${FOCUS}`;
export const ICON_BTN = `grid size-8 flex-none place-items-center rounded-md border border-repo-border text-repo-muted hover:bg-repo-btn-hover disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`;
export const LINK = `text-repo-accent hover:underline ${FOCUS}`;
export const BOX = "rounded-md border border-repo-border";
export const INPUT = `h-8 rounded-md border border-repo-border bg-repo-input px-3 text-[14px] text-repo-fg placeholder:text-repo-muted focus:border-repo-focus focus:outline-2 focus:outline-offset-[-1px] focus:outline-repo-focus`;
export { FOCUS };

// An avatar: the identicon of a name, round for people, square-ish for teams and bots.
export function Avatar({ seed, size, square = false }: { seed: string; size: number; square?: boolean }) {
  const { cells, hue } = identicon(seed);
  const pad = Math.max(1, Math.round(size / 10));
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none grid-cols-5 grid-rows-5 overflow-hidden border border-repo-border-muted bg-repo-subtle ${
        square ? "rounded-md" : "rounded-full"
      }`}
      style={{ width: size, height: size, padding: pad }}
    >
      {cells.map((on, index) => (
        <span key={index} style={on ? { background: `hsl(${hue} 52% 58%)` } : undefined} />
      ))}
    </span>
  );
}

export function Label({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" }) {
  return (
    <span
      className={`inline-flex flex-none items-center rounded-full border px-[7px] text-[12px] font-medium leading-[18px] ${
        tone === "accent"
          ? "border-transparent bg-repo-accent-soft text-repo-accent font-repo-mono"
          : "border-repo-border text-repo-muted"
      }`}
    >
      {children}
    </span>
  );
}

export function Counter({ value }: { value: number | string }) {
  return (
    <span className="inline-block min-w-[20px] rounded-full bg-repo-counter px-1.5 text-center text-[12px] font-medium leading-[18px] text-repo-fg">
      {value}
    </span>
  );
}

export type StatusKind = "running" | "success" | "failure" | "queued";

// Check status the way the site marks a commit or a run: a yellow dot (or spinner) while
// running, a green check, a red cross, a hollow circle while queued.
export function StatusIcon({ status, size = 16, spin = false, label }: { status: StatusKind; size?: number; spin?: boolean; label?: string }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  if (status === "running") {
    return spin ? (
      <span {...a11y} className="inline-grid flex-none place-items-center text-repo-attention-dot">
        <LoaderCircle size={size} className="animate-spin" />
      </span>
    ) : (
      <span {...a11y} className="inline-grid flex-none place-items-center" style={{ width: size, height: size }}>
        <span className="size-2 rounded-full bg-repo-attention-dot" />
      </span>
    );
  }
  const Icon = status === "success" ? Check : status === "failure" ? X : Circle;
  const tone = status === "success" ? "text-repo-success" : status === "failure" ? "text-repo-danger" : "text-repo-muted";
  return (
    <span {...a11y} className={`inline-grid flex-none place-items-center ${tone}`}>
      <Icon size={size} strokeWidth={status === "queued" ? 2 : 2.5} />
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[4px] border border-repo-border px-1 font-repo-mono text-[11px] leading-none text-repo-muted">
      {children}
    </kbd>
  );
}

// "‹ Previous 1 2 … 9 Next ›" under a long list.
export function Pagination({
  page,
  pages,
  onPage,
  label,
  previousLabel,
  nextLabel,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  label: string;
  previousLabel: string;
  nextLabel: string;
}) {
  if (pages <= 1) return null;
  const item = (entry: PageItem, index: number) =>
    entry === "gap" ? (
      <span key={`gap-${index}`} className="px-2 text-repo-muted" aria-hidden="true">
        …
      </span>
    ) : (
      <button
        key={entry}
        type="button"
        aria-current={entry === page ? "page" : undefined}
        onClick={() => onPage(entry)}
        className={`h-8 min-w-8 rounded-md px-2 text-[14px] ${FOCUS} ${
          entry === page ? "bg-repo-accent font-semibold text-white" : "text-repo-fg hover:bg-repo-btn-hover"
        }`}
      >
        {entry + 1}
      </button>
    );
  const step = `inline-flex h-8 items-center gap-1 rounded-md px-2 text-[14px] ${FOCUS} enabled:text-repo-accent enabled:hover:bg-repo-btn-hover disabled:text-repo-muted`;
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center justify-center gap-1">
      <button type="button" className={step} disabled={page <= 0} onClick={() => onPage(page - 1)} aria-label={previousLabel}>
        <ChevronLeft size={16} aria-hidden="true" />
        <span>Previous</span>
      </button>
      {pageItems(page, pages).map(item)}
      <button type="button" className={step} disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label={nextLabel}>
        <span>Next</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}

// A banner across the page: an error, or something to look at.
export function Flash({
  tone,
  children,
  onDismiss,
  dismissLabel,
}: {
  tone: "danger" | "attention";
  children: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const tones = {
    danger: "border-repo-danger-rule bg-repo-danger-soft",
    attention: "border-repo-attention-rule bg-repo-attention-soft",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex items-start gap-3 rounded-md border px-4 py-3 text-[14px] ${tones[tone]}`}>
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label={dismissLabel} title={dismissLabel} className={`flex-none rounded-md p-0.5 text-repo-muted hover:text-repo-fg ${FOCUS}`}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-[14px] text-repo-muted">
      <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

// An empty state inside a box: a muted icon, a heading and a line of text.
export function Blankslate({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="mb-4 text-repo-muted" aria-hidden="true">
        {icon}
      </span>
      <h3 className="mb-1 text-[20px] font-semibold">{title}</h3>
      {children && <div className="max-w-[480px] text-[14px] text-repo-muted">{children}</div>}
    </div>
  );
}

export interface HeaderActions {
  onMenu: (element: HTMLElement) => void;
  onHome: () => void;
  onRepo?: () => void;
  onSearch: () => void;
  onAccount: (element: HTMLElement) => void;
  labels: { menu: string; search: string; account: string; home: string };
}

/**
 * The site's top bar: menu, mark, "team / repo", the "Type / to search" box, a few icon
 * buttons and the avatar. With no `actions` (the decoy) everything is drawn but nothing
 * is a control, so the decoy answers to none of the shell's accessible names.
 */
export const GlobalHeader = forwardRef<HTMLElement, { org: string; repo?: string | null; actions?: HeaderActions; children?: ReactNode }>(
  function GlobalHeader({ org, repo, actions, children }, ref) {
    const iconOnly = "grid size-8 flex-none place-items-center rounded-md border border-repo-border text-repo-muted";
    const crumb = "rounded-md px-1.5 py-0.5 text-[14px] hover:bg-repo-btn-hover";
    return (
      <header ref={ref} className="border-b border-repo-border bg-repo-header px-4 pt-4 md:px-6">
        <div className="flex h-8 items-center gap-2 pb-0">
          {actions ? (
            <button type="button" className={ICON_BTN} aria-label={actions.labels.menu} title={actions.labels.menu} aria-haspopup="menu" onClick={(event) => actions.onMenu(event.currentTarget)}>
              <Menu size={16} aria-hidden="true" />
            </button>
          ) : (
            <span className={iconOnly} aria-hidden="true">
              <Menu size={16} />
            </span>
          )}
          {actions ? (
            <button type="button" className={`ml-1 flex-none rounded-full text-repo-fg ${FOCUS}`} aria-label={actions.labels.home} title={actions.labels.home} onClick={actions.onHome}>
              <Hexagon size={30} strokeWidth={1.75} aria-hidden="true" />
            </button>
          ) : (
            <span className="ml-1 flex-none text-repo-fg" aria-hidden="true">
              <Hexagon size={30} strokeWidth={1.75} />
            </span>
          )}
          <nav aria-label="Breadcrumbs" className="ml-1 flex min-w-0 items-center gap-0.5">
            {actions ? (
              <button type="button" className={`${crumb} ${FOCUS}`} onClick={actions.onHome}>
                {org}
              </button>
            ) : (
              <span className={crumb}>{org}</span>
            )}
            {repo && (
              <>
                <span className="text-repo-muted">/</span>
                {actions?.onRepo ? (
                  <button type="button" className={`${crumb} min-w-0 truncate font-semibold ${FOCUS}`} onClick={actions.onRepo}>
                    {repo}
                  </button>
                ) : (
                  <span className={`${crumb} min-w-0 truncate font-semibold`}>{repo}</span>
                )}
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {actions ? (
              <button
                type="button"
                onClick={actions.onSearch}
                aria-label={actions.labels.search}
                className={`hidden h-8 w-[272px] items-center gap-2 rounded-md border border-repo-border bg-repo-input px-2 text-left text-[14px] text-repo-muted hover:border-repo-muted md:flex ${FOCUS}`}
              >
                <Search size={16} aria-hidden="true" />
                <span className="flex-1">
                  Type <Kbd>/</Kbd> to search
                </span>
              </button>
            ) : (
              <span className="hidden h-8 w-[272px] items-center gap-2 rounded-md border border-repo-border bg-repo-input px-2 text-[14px] text-repo-muted md:flex">
                <Search size={16} />
                <span className="flex-1">
                  Type <Kbd>/</Kbd> to search
                </span>
              </span>
            )}
            {actions && (
              <button type="button" className={`${ICON_BTN} md:hidden`} aria-label={actions.labels.search} onClick={actions.onSearch}>
                <Search size={16} aria-hidden="true" />
              </button>
            )}
            <span className="mx-1 hidden h-5 w-px bg-repo-border sm:block" aria-hidden="true" />
            <span className={`${iconOnly} hidden w-auto gap-0.5 px-1.5 sm:flex`} aria-hidden="true">
              <Plus size={16} />
              <ChevronDown size={12} />
            </span>
            <span className={`${iconOnly} hidden sm:grid`} aria-hidden="true">
              <CircleDot size={16} />
            </span>
            <span className={`${iconOnly} hidden sm:grid`} aria-hidden="true">
              <GitPullRequest size={16} />
            </span>
            <span className={`${iconOnly} hidden sm:grid`} aria-hidden="true">
              <Inbox size={16} />
            </span>
            {actions ? (
              <button type="button" className={`flex-none rounded-full ${FOCUS}`} aria-label={actions.labels.account} title={actions.labels.account} aria-haspopup="menu" onClick={(event) => actions.onAccount(event.currentTarget)}>
                <Avatar seed="dev" size={32} />
              </button>
            ) : (
              <Avatar seed="dev" size={32} />
            )}
          </div>
        </div>
        {children ?? <div className="h-4" />}
      </header>
    );
  }
);

export interface NavTab<Id extends string> {
  id: Id;
  label: string;
  icon: ReactNode;
  counter?: number;
  // Drawn for the look, not a control (the site's tabs this skin has nothing behind).
  inert?: boolean;
}

// The underline navigation under the header: the current tab carries the coloured bar.
export function UnderlineNav<Id extends string>({
  tabs,
  current,
  onSelect,
  label,
}: {
  tabs: NavTab<Id>[];
  current: Id;
  onSelect?: (id: Id) => void;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mb-px mt-2 flex gap-1 overflow-x-auto [scrollbar-width:none]">
      {tabs.map((tab) => {
        const active = tab.id === current;
        const inner = (
          <>
            <span className="text-repo-muted">{tab.icon}</span>
            <span className={active ? "font-semibold" : ""}>{tab.label}</span>
            {tab.counter !== undefined && tab.counter > 0 && <Counter value={tab.counter} />}
          </>
        );
        const base = "relative flex flex-none items-center gap-2 whitespace-nowrap px-2 pb-3 pt-1 text-[14px] text-repo-fg";
        const bar = active ? "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-repo-tab-active" : "";
        if (tab.inert || !onSelect) {
          return (
            <span key={tab.id} className={`${base} ${bar} ${tab.inert ? "hidden lg:flex" : ""}`} aria-hidden={tab.inert ? true : undefined}>
              <span className="flex items-center gap-2 rounded-md px-2 py-1">{inner}</span>
            </span>
          );
        }
        return (
          <button key={tab.id} type="button" aria-current={active ? "page" : undefined} onClick={() => onSelect(tab.id)} className={`${base} ${bar} group outline-none`}>
            <span className="flex items-center gap-2 rounded-md px-2 py-1 group-hover:bg-repo-btn-hover group-focus-visible:outline-2 group-focus-visible:outline-repo-focus">{inner}</span>
          </button>
        );
      })}
    </nav>
  );
}

// A toast in the corner for short notices ("Nothing later.").
export function Toast({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="fixed bottom-4 left-4 z-30 max-w-[min(420px,calc(100vw-32px))] rounded-md bg-repo-toast px-4 py-3 text-[14px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
      {children}
    </div>
  );
}
