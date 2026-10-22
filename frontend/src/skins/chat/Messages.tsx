import { Bot, CalendarDays, FileText, Image, Reply, SmilePlus, EllipsisVertical } from "lucide-react";
import { ReactNode } from "react";
import { Avatar } from "./Avatar";

export interface ShownMessage {
  key: string;
  // The chapter line, for the reading position (absent for made-up messages).
  line?: number;
  kind: "text" | "media";
  text: string;
}

// Hover tools on a message, drawn only.
function HoverTools() {
  return (
    <span
      className="absolute -top-4 right-3 z-10 hidden items-center gap-0.5 rounded-full border border-chat-rule bg-chat-surface px-1 py-0.5 text-chat-dim shadow-[0_1px_3px_rgba(0,0,0,0.12)] group-hover/line:flex"
      aria-hidden="true"
    >
      <span className="grid size-7 place-items-center rounded-full">
        <SmilePlus size={16} strokeWidth={1.8} />
      </span>
      <span className="grid size-7 place-items-center rounded-full">
        <Reply size={16} strokeWidth={1.8} />
      </span>
      <span className="grid size-7 place-items-center rounded-full">
        <EllipsisVertical size={16} strokeWidth={1.8} />
      </span>
    </span>
  );
}

// A picture or clip in a message: a chip naming it, with no address and nothing loaded.
export function MediaChip({ text }: { text: string }) {
  return (
    <span className="my-1 inline-flex max-w-full items-center gap-2 rounded-xl border border-chat-rule bg-chat-chip px-3 py-2 text-[13.5px] text-chat-dim">
      <Image size={18} strokeWidth={1.8} className="flex-none text-chat-av-3" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * One person's run of consecutive messages: avatar, name and time on the first, the rest
 * under it with the time showing on hover — how the chat groups them. Text is set for
 * long reading: 15px, generous leading, about 70 characters a line.
 */
export function MessageGroup({
  name,
  tone,
  time,
  messages,
  badge,
}: {
  name: string;
  tone: number;
  time: string;
  messages: ShownMessage[];
  badge?: string;
}) {
  const short = time.replace(/\s?[AP]M$/, "");
  return (
    <div className="mt-2">
      {messages.map((message, index) => (
        <div
          key={message.key}
          data-line={message.line}
          className="group/line relative flex gap-3 rounded-lg px-2 py-[3px] hover:bg-chat-hover"
        >
          <div className="w-9 flex-none">
            {index === 0 ? (
              <span className="mt-1 block">
                <Avatar name={name} tone={tone} size={36} />
              </span>
            ) : (
              <span
                className="invisible block pt-[3px] text-right text-[11px] leading-[22px] text-chat-faint group-hover/line:visible"
                aria-hidden="true"
              >
                {short}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {index === 0 && (
              <div className="flex items-baseline gap-2 pt-0.5">
                <span className="text-[14px] font-semibold text-chat-fg">{name}</span>
                {badge && (
                  <span className="rounded bg-chat-rail-hover px-1 text-[10.5px] font-medium uppercase tracking-wide text-chat-dim">
                    {badge}
                  </span>
                )}
                <span className="text-[12px] text-chat-faint">{time}</span>
              </div>
            )}
            {message.kind === "media" ? (
              <MediaChip text={message.text} />
            ) : (
              <p className="max-w-[70ch] whitespace-pre-wrap break-words text-[15px] leading-[1.65] text-chat-fg">
                {message.text}
              </p>
            )}
          </div>
          <HoverTools />
        </div>
      ))}
    </div>
  );
}

export function DayDivider({ label }: { label: string }) {
  return (
    <div role="separator" className="my-5 flex items-center gap-3 text-[12px] font-medium text-chat-dim">
      <span className="h-px flex-1 bg-chat-rule" />
      <span className="rounded-full border border-chat-rule px-3 py-1">{label}</span>
      <span className="h-px flex-1 bg-chat-rule" />
    </div>
  );
}

// A heading inside a thread: a divider that carries its text, like a date divider.
export function HeadingDivider({ text, line }: { text: string; line?: number }) {
  return (
    <div data-line={line} className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-chat-rule" />
      <h3 className="max-w-[80%] text-center text-[14px] font-semibold leading-snug text-chat-fg">{text}</h3>
      <span className="h-px flex-1 bg-chat-rule" />
    </div>
  );
}

// An app's message (the sync helper), labelled as an app and as visible to the reader only.
export function BotMessage({ name, time, children, note }: { name: string; time: string; children: ReactNode; note: string }) {
  return (
    <div className="mt-3 flex gap-3 rounded-lg px-2 py-1">
      <span className="mt-1 grid size-9 flex-none place-items-center rounded-full bg-chat-green-soft text-chat-green-fg" aria-hidden="true">
        <Bot size={20} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 pt-0.5">
          <span className="text-[14px] font-semibold text-chat-fg">{name}</span>
          <span className="rounded bg-chat-rail-hover px-1 text-[10.5px] font-medium uppercase tracking-wide text-chat-dim">
            App
          </span>
          <span className="text-[12px] text-chat-faint">{time}</span>
        </div>
        <div className="mt-1 max-w-[560px] rounded-2xl border border-chat-rule bg-chat-chip px-4 py-3 text-[14px] text-chat-fg">
          {children}
        </div>
        <p className="mt-1 text-[11.5px] text-chat-faint">{note}</p>
      </div>
    </div>
  );
}

// A line from the chat itself, centred: errors, "nothing here yet".
export function SystemNote({ tone = "dim", children }: { tone?: "dim" | "error"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`mx-auto my-4 w-fit max-w-[90%] rounded-xl px-4 py-2.5 text-center text-[13.5px] ${
        tone === "error" ? "bg-chat-error-soft text-chat-error" : "bg-chat-composer text-chat-dim"
      }`}
    >
      {children}
    </div>
  );
}

// Grey bars where messages will be.
export function SkeletonMessages({ label }: { label: string }) {
  const widths = ["w-11/12", "w-3/4", "w-5/6", "w-2/3", "w-4/5", "w-1/2"];
  return (
    <div role="status" aria-label={label} className="pt-6">
      {widths.map((width, index) => (
        <div key={index} className="flex gap-3 px-2 py-3">
          <span className="size-9 flex-none animate-pulse rounded-full bg-chat-skeleton" />
          <span className="flex-1 space-y-2 pt-1">
            <span className="block h-3 w-28 animate-pulse rounded-full bg-chat-skeleton" />
            <span className={`block h-3 animate-pulse rounded-full bg-chat-skeleton ${width}`} />
            <span className="block h-3 w-1/3 animate-pulse rounded-full bg-chat-skeleton" />
          </span>
        </div>
      ))}
    </div>
  );
}

// A shared document in a message: the file's chip (the decoy's).
export function DocChip({ file, detail }: { file: string; detail: string }) {
  return (
    <span className="mt-1.5 flex w-fit max-w-full items-center gap-3 rounded-xl border border-chat-rule bg-chat-chip py-2 pl-3 pr-5">
      <span className="grid size-9 flex-none place-items-center rounded-lg bg-chat-av-1 text-white">
        <FileText size={20} strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-medium text-chat-fg">{file}</span>
        <span className="block truncate text-[12px] text-chat-dim">{detail}</span>
      </span>
    </span>
  );
}

// A meeting invitation card (the decoy's).
export function MeetingCard({ title, when, room }: { title: string; when: string; room: string }) {
  return (
    <span className="mt-1.5 block w-full max-w-[460px] overflow-hidden rounded-2xl border border-chat-rule bg-chat-chip">
      <span className="flex items-start gap-3 px-4 py-3">
        <span className="grid size-9 flex-none place-items-center rounded-lg bg-chat-av-2 text-white">
          <CalendarDays size={20} strokeWidth={1.8} />
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-medium text-chat-fg">{title}</span>
          <span className="mt-0.5 block text-[12.5px] text-chat-dim">{when}</span>
          <span className="block text-[12.5px] text-chat-dim">{room}</span>
        </span>
      </span>
      <span className="flex gap-2 border-t border-chat-rule px-4 py-2.5 text-[13px] font-medium">
        <span className="rounded-full bg-chat-accent px-4 py-1.5 text-chat-accent-fg">Join</span>
        <span className="rounded-full border border-chat-rule px-4 py-1.5 text-chat-accent">Yes</span>
        <span className="rounded-full border border-chat-rule px-4 py-1.5 text-chat-dim">No</span>
      </span>
    </span>
  );
}
