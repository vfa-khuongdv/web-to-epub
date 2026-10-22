import { ArrowLeft, EllipsisVertical, MessagesSquare, Search, Video } from "lucide-react";
import { ReactNode } from "react";
import { Avatar } from "./Avatar";
import { Presence } from "./fakeData";

const ICON =
  "grid size-10 flex-none place-items-center rounded-full text-chat-dim outline-none hover:bg-chat-rail-hover focus-visible:ring-2 focus-visible:ring-chat-accent";

/**
 * The bar above a conversation: who or which space, a status line under the name, the
 * space's tabs, and its actions (threads, search, more). Handlers left out are drawn only
 * (the decoy, a direct message).
 */
export function ConversationHeader({
  name,
  tone,
  initials,
  presence,
  status,
  space,
  onBack,
  onThreads,
  threadsOpen,
  onSearch,
  onMore,
  labels,
}: {
  name: string;
  tone: number;
  initials?: string;
  presence?: Presence;
  status: ReactNode;
  space: boolean;
  onBack?: () => void;
  onThreads?: () => void;
  threadsOpen?: boolean;
  onSearch?: () => void;
  onMore?: (element: HTMLElement) => void;
  labels?: { back: string; search: string };
}) {
  return (
    <header className="flex-none border-b border-chat-rule">
      <div className="flex h-16 items-center gap-2 pl-3 pr-2 sm:pl-5">
        {onBack && (
          <button type="button" className={`${ICON} md:hidden`} onClick={onBack} aria-label={labels?.back} title={labels?.back}>
            <ArrowLeft size={20} />
          </button>
        )}
        <Avatar name={name} tone={tone} text={initials} size={36} square={space} presence={presence} />
        <div className="ml-1 min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-normal leading-tight text-chat-fg">{name}</h2>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-chat-dim">{status}</div>
        </div>
        {onThreads ? (
          <button
            type="button"
            className={`flex h-9 flex-none items-center gap-2 rounded-full px-3 text-[14px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-chat-accent ${
              threadsOpen ? "bg-chat-active text-chat-active-fg" : "text-chat-dim hover:bg-chat-rail-hover"
            }`}
            aria-pressed={!!threadsOpen}
            onClick={onThreads}
          >
            <MessagesSquare size={18} strokeWidth={1.8} />
            <span className="max-sm:sr-only">Threads</span>
          </button>
        ) : (
          <span className={`${ICON} max-sm:hidden`} aria-hidden="true">
            <Video size={20} strokeWidth={1.8} />
          </span>
        )}
        {onSearch ? (
          <button type="button" className={ICON} onClick={onSearch} aria-label={labels?.search} title={labels?.search}>
            <Search size={20} strokeWidth={1.8} />
          </button>
        ) : (
          <span className={ICON} aria-hidden="true">
            <Search size={20} strokeWidth={1.8} />
          </span>
        )}
        {onMore ? (
          <button
            type="button"
            className={ICON}
            onClick={(event) => onMore(event.currentTarget)}
            aria-label="More options"
            title="More options"
            aria-haspopup="menu"
          >
            <EllipsisVertical size={20} strokeWidth={1.8} />
          </button>
        ) : (
          <span className={ICON} aria-hidden="true">
            <EllipsisVertical size={20} strokeWidth={1.8} />
          </span>
        )}
      </div>
      {space && (
        // The space's tabs: only the chat is real here.
        <div className="flex gap-6 px-5 text-[14px] font-medium sm:px-7" aria-hidden="true">
          <span className="border-b-2 border-chat-accent pb-2 text-chat-accent">Messages</span>
          <span className="pb-2 text-chat-dim">Files</span>
          <span className="pb-2 text-chat-dim">Pinned</span>
        </div>
      )}
    </header>
  );
}
