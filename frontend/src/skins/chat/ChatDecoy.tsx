// What the boss key shows in the chat skin: a project team's space in the same program
// frame — a deadline, a shared document, a meeting card. Static, no story in it, nothing
// fetched; nothing in it answers to the shell's accessible names, since the shell stays
// mounted underneath.
import { CirclePlus, Paperclip, SendHorizontal, Smile, Type } from "lucide-react";
import { Avatar } from "./Avatar";
import { Rail, RailEntry, TopBar } from "./ChatChrome";
import { ConversationHeader } from "./ConversationHeader";
import { CONTACTS, DECOY_ITEMS, DECOY_MEMBERS, DECOY_SPACE, DECOY_SPACES } from "./fakeData";
import { DayDivider, DocChip, MeetingCard, MessageGroup } from "./Messages";
import { spaceInitials, toneFor } from "./spaces";

const CONTACT_ROWS: RailEntry[] = CONTACTS.map((contact) => ({
  key: contact.id,
  name: contact.name,
  tone: contact.tone,
  presence: contact.presence,
  active: false,
}));

const SPACE_ROWS: RailEntry[] = DECOY_SPACES.map((space) => ({
  key: space.name,
  name: space.name,
  tone: toneFor(space.name),
  initials: spaceInitials(space.name),
  active: space.active,
  unread: space.unread,
}));

// Consecutive messages from one person share a header, as in the shell.
function Items() {
  const out: JSX.Element[] = [];
  let index = 0;
  while (index < DECOY_ITEMS.length) {
    const item = DECOY_ITEMS[index];
    if (item.kind === "day") {
      out.push(<DayDivider key={index} label={item.label} />);
      index++;
      continue;
    }
    if (item.kind === "message") {
      const run = [item];
      while (index + run.length < DECOY_ITEMS.length) {
        const next = DECOY_ITEMS[index + run.length];
        if (next.kind !== "message" || next.from !== item.from) break;
        run.push(next);
      }
      const member = DECOY_MEMBERS[item.from];
      out.push(
        <MessageGroup
          key={index}
          name={member.name}
          tone={member.tone}
          time={item.time}
          messages={run.map((message, at) => ({ key: String(at), kind: "text", text: message.text }))}
        />
      );
      index += run.length;
      continue;
    }
    const member = DECOY_MEMBERS[item.from];
    out.push(
      <div key={index} className="mt-2 flex gap-3 px-2 py-[3px]">
        <span className="mt-1 block">
          <Avatar name={member.name} tone={member.tone} size={36} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 pt-0.5">
            <span className="text-[14px] font-semibold text-chat-fg">{member.name}</span>
            <span className="text-[12px] text-chat-faint">{item.time}</span>
          </div>
          <p className="max-w-[70ch] text-[15px] leading-[1.65] text-chat-fg">{item.text}</p>
          {item.kind === "doc" ? (
            <DocChip file={item.file} detail={item.detail} />
          ) : (
            <MeetingCard title={item.title} when={item.when} room={item.room} />
          )}
        </div>
      </div>
    );
    index++;
  }
  return <>{out}</>;
}

export default function ChatDecoy() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-chat-app font-chat text-chat-fg" aria-hidden="true">
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        <div className="flex max-md:hidden">
          <Rail home={{ active: false }} contacts={CONTACT_ROWS} spaces={SPACE_ROWS} />
        </div>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-chat-surface md:mb-3 md:mr-3 md:rounded-2xl">
          <ConversationHeader
            name={DECOY_SPACE}
            tone={toneFor(DECOY_SPACE)}
            initials={spaceInitials(DECOY_SPACE)}
            status="12 members · Deadline UAT: Thứ Sáu"
            space
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="mx-auto w-full max-w-[880px] px-3 pb-8 pt-2 sm:px-6">
              <Items />
            </div>
          </div>
          <div className="flex-none px-3 pb-4 pt-1 sm:px-6">
            <div className="mx-auto flex max-w-[880px] items-center gap-1 rounded-[28px] bg-chat-composer py-1.5 pl-2 pr-1.5">
              <span className="grid size-9 place-items-center text-chat-dim">
                <CirclePlus size={20} strokeWidth={1.8} />
              </span>
              <span className="h-10 flex-1 px-2 text-[15px] leading-10 text-chat-faint">Message {DECOY_SPACE}</span>
              <span className="grid size-9 place-items-center text-chat-dim max-sm:hidden">
                <Type size={19} strokeWidth={1.8} />
              </span>
              <span className="grid size-9 place-items-center text-chat-dim max-sm:hidden">
                <Smile size={20} strokeWidth={1.8} />
              </span>
              <span className="grid size-9 place-items-center text-chat-dim max-sm:hidden">
                <Paperclip size={19} strokeWidth={1.8} />
              </span>
              <span className="grid size-9 place-items-center text-chat-faint">
                <SendHorizontal size={20} strokeWidth={1.8} />
              </span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
