import {
  AtSign,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  House,
  Menu,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Star,
} from "lucide-react";
import { ReactNode, useState } from "react";
import { Avatar } from "./Avatar";
import { Presence } from "./fakeData";

const ICON_BUTTON =
  "grid size-10 flex-none place-items-center rounded-full text-chat-dim outline-none hover:bg-chat-rail-hover focus-visible:ring-2 focus-visible:ring-chat-accent";

// A control that works in the shell and is only drawn in the decoy (no handler): the decoy
// sits over the still-mounted shell and must not answer to the same names.
function Control({
  onClick,
  label,
  className,
  children,
  pressed,
}: {
  onClick?: (element: HTMLElement) => void;
  label: string;
  className: string;
  children: ReactNode;
  pressed?: boolean;
}) {
  if (!onClick)
    return (
      <span className={className} aria-hidden="true">
        {children}
      </span>
    );
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={className}
      onClick={(event) => onClick(event.currentTarget)}
    >
      {children}
    </button>
  );
}

/**
 * The bar across the top: the menu button, a plain mark and name (a generic "@" tile —
 * never another product's logo), the rounded search box (here the command list), help,
 * settings and the account avatar with its status dot.
 */
export function TopBar({
  onMenu,
  onSearch,
  onSettings,
  onAccount,
  labels,
}: {
  onMenu?: () => void;
  onSearch?: () => void;
  onSettings?: () => void;
  onAccount?: (element: HTMLElement) => void;
  labels?: { menu: string; search: string; settings: string };
}) {
  return (
    <header className="flex h-16 flex-none items-center gap-2 pl-2 pr-3 sm:pr-4">
      <Control onClick={onMenu ? () => onMenu() : undefined} label={labels?.menu ?? ""} className={ICON_BUTTON}>
        <Menu size={22} strokeWidth={1.8} />
      </Control>
      <span className="flex w-[200px] flex-none items-center gap-2.5 pl-1 max-sm:w-auto" aria-hidden="true">
        <span className="grid size-8 place-items-center rounded-lg bg-chat-brand text-white">
          <AtSign size={18} strokeWidth={2.2} />
        </span>
        <span className="text-[18px] font-semibold tracking-[-0.01em] text-chat-fg max-sm:hidden">Chat</span>
      </span>
      <div className="flex min-w-0 flex-1 justify-center lg:justify-start">
        <Control
          onClick={onSearch ? () => onSearch() : undefined}
          label={labels?.search ?? ""}
          className="flex h-12 w-full max-w-[720px] items-center gap-3 rounded-full bg-chat-search px-4 text-left text-[15px] text-chat-dim outline-none hover:shadow-[0_1px_2px_rgba(0,0,0,0.15)] focus-visible:ring-2 focus-visible:ring-chat-accent max-sm:size-10 max-sm:justify-center max-sm:bg-transparent max-sm:px-0"
        >
          <Search size={20} strokeWidth={1.8} className="flex-none" />
          <span className="truncate max-sm:hidden">Search in chat</span>
        </Control>
      </div>
      <span className={`${ICON_BUTTON} max-md:hidden`} aria-hidden="true">
        <CircleHelp size={22} strokeWidth={1.8} />
      </span>
      <Control onClick={onSettings ? () => onSettings() : undefined} label={labels?.settings ?? ""} className={ICON_BUTTON}>
        <Settings size={22} strokeWidth={1.8} />
      </Control>
      <Control onClick={onAccount} label="Account" className={`${ICON_BUTTON} size-11`}>
        <Avatar name="You" tone={2} text="T" size={32} presence="active" />
      </Control>
    </header>
  );
}

export interface RailEntry {
  key: string;
  name: string;
  tone: number;
  active: boolean;
  unread?: number;
  // Something is still coming in (the open space's downloads).
  busy?: boolean;
  presence?: Presence;
  initials?: string;
  // Spoken after the name: the unread count, in words.
  detail?: string;
  onClick?: () => void;
}

const ITEM =
  "flex h-8 w-full min-w-0 items-center gap-3 rounded-full pl-4 pr-3 text-left text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-chat-accent";

const NEW_CHAT =
  "mb-3 ml-2 mt-1 flex h-10 w-[calc(100%-8px)] items-center gap-2.5 rounded-xl border border-chat-rule bg-chat-surface px-3.5 text-[14px] font-medium text-chat-fg outline-none";

function itemTone(active: boolean, unread: boolean) {
  if (active) return "bg-chat-active font-semibold text-chat-active-fg";
  return `${unread ? "font-semibold text-chat-fg" : "text-chat-dim"} hover:bg-chat-rail-hover`;
}

function RailRow({ entry, square }: { entry: RailEntry; square: boolean }) {
  const unread = (entry.unread ?? 0) > 0;
  const body = (
    <>
      <Avatar
        name={entry.name}
        tone={entry.tone}
        size={20}
        square={square}
        text={entry.initials ? entry.initials.slice(0, 1) : undefined}
        presence={entry.presence}
      />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {entry.busy && (
        <RefreshCw size={13} strokeWidth={2} className="flex-none animate-[spin_2.4s_linear_infinite] text-chat-online" />
      )}
      {unread && (
        <span className="min-w-[20px] flex-none rounded-full px-1.5 text-center text-[12px] font-semibold leading-[18px] text-chat-dim">
          {(entry.unread ?? 0) > 99 ? "99+" : entry.unread}
        </span>
      )}
    </>
  );
  if (!entry.onClick) return <span className={`${ITEM} ${itemTone(entry.active, unread)}`}>{body}</span>;
  return (
    <button
      type="button"
      className={`${ITEM} ${itemTone(entry.active, unread)}`}
      aria-current={entry.active ? "page" : undefined}
      aria-label={entry.detail ? `${entry.name}, ${entry.detail}` : entry.name}
      onClick={entry.onClick}
    >
      {body}
    </button>
  );
}

function Section({ title, label, children }: { title: string; label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="mt-3">
      <button
        type="button"
        className="flex h-8 w-full items-center gap-1 rounded-full pl-2 pr-3 text-left text-[14px] font-medium text-chat-fg outline-none hover:bg-chat-rail-hover focus-visible:ring-2 focus-visible:ring-chat-accent"
        aria-expanded={open}
        tabIndex={label ? 0 : -1}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        {title}
      </button>
      {open && (
        <ul aria-label={label} className="mt-0.5 space-y-px">
          {children}
        </ul>
      )}
    </section>
  );
}

/**
 * The left rail: a plain "New chat" button, the fixed shortcuts, then direct messages and spaces.
 * `footer` sits under the spaces (a "load more" link, a loading line, an error).
 */
export function Rail({
  home,
  onNewChat,
  contacts,
  spaces,
  footer,
  labels,
}: {
  home: { active: boolean; onClick?: () => void };
  onNewChat?: () => void;
  contacts: RailEntry[];
  spaces: RailEntry[];
  footer?: ReactNode;
  labels?: { nav: string; contacts: string; spaces: string };
}) {
  const live = !!labels;
  return (
    <nav
      aria-label={labels?.nav}
      aria-hidden={live ? undefined : true}
      className="flex w-[256px] flex-none flex-col overflow-y-auto pb-4 pl-2 pr-3 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:bg-chat-app max-md:shadow-[4px_0_16px_rgba(0,0,0,0.16)]"
    >
      {onNewChat ? (
        <button type="button" onClick={onNewChat} className={`${NEW_CHAT} hover:bg-chat-hover focus-visible:ring-2 focus-visible:ring-chat-accent`}>
          <Pencil size={17} strokeWidth={1.8} />
          New chat
        </button>
      ) : (
        <span className={NEW_CHAT}>
          <Pencil size={17} strokeWidth={1.8} />
          New chat
        </span>
      )}
      <ul className="space-y-px">
        <li>
          {home.onClick ? (
            <button
              type="button"
              className={`${ITEM} ${itemTone(home.active, false)}`}
              aria-current={home.active ? "page" : undefined}
              onClick={home.onClick}
            >
              <House size={18} strokeWidth={1.8} />
              Home
            </button>
          ) : (
            <span className={`${ITEM} ${itemTone(home.active, false)}`}>
              <House size={18} strokeWidth={1.8} />
              Home
            </span>
          )}
        </li>
        <li aria-hidden="true" className={`${ITEM} ${itemTone(false, false)}`}>
          <AtSign size={18} strokeWidth={1.8} />
          Mentions
        </li>
        <li aria-hidden="true" className={`${ITEM} ${itemTone(false, false)}`}>
          <Star size={18} strokeWidth={1.8} />
          Starred
        </li>
      </ul>
      <Section title="Direct messages" label={labels?.contacts}>
        {contacts.map((entry) => (
          <li key={entry.key}>
            <RailRow entry={entry} square={false} />
          </li>
        ))}
      </Section>
      <Section title="Spaces" label={labels?.spaces}>
        {spaces.map((entry) => (
          <li key={entry.key}>
            <RailRow entry={entry} square />
          </li>
        ))}
      </Section>
      {footer && <div className="mt-1 pl-4 text-[13px]">{footer}</div>}
    </nav>
  );
}
