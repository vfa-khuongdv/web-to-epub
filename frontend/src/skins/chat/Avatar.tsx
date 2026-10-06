import { User } from "lucide-react";
import { Presence } from "./fakeData";

// Spelled out, so Tailwind sees every class.
const TONES = [
  "bg-chat-av-0",
  "bg-chat-av-1",
  "bg-chat-av-2",
  "bg-chat-av-3",
  "bg-chat-av-4",
  "bg-chat-av-5",
  "bg-chat-av-6",
  "bg-chat-av-7",
  "bg-chat-av-8",
];

const PRESENCE: Record<Presence, string> = {
  active: "bg-chat-online",
  away: "bg-chat-surface ring-[1.5px] ring-inset ring-chat-faint",
  busy: "bg-chat-av-3",
};

export function toneClass(tone: number): string {
  return TONES[((tone % TONES.length) + TONES.length) % TONES.length];
}

/**
 * A coloured initial, round for people and rounded-square for spaces, as the chat draws
 * them when nobody has set a picture. Tone 0 is the reader: a plain person glyph.
 */
export function Avatar({
  name,
  tone,
  size = 32,
  square = false,
  text,
  presence,
}: {
  name: string;
  tone: number;
  size?: number;
  square?: boolean;
  // Overrides the initial (a space's two letters).
  text?: string;
  presence?: Presence;
}) {
  const letter = text ?? (Array.from(name.trim())[0] ?? "?").toUpperCase();
  return (
    <span className="relative inline-flex flex-none" style={{ width: size, height: size }} aria-hidden="true">
      <span
        className={`grid size-full place-items-center font-medium text-white ${toneClass(tone)} ${
          square ? "rounded-[10px]" : "rounded-full"
        }`}
        style={{ fontSize: Math.round(size * (text && text.length > 1 ? 0.36 : 0.44)) }}
      >
        {tone === 0 && !text ? <User size={Math.round(size * 0.56)} strokeWidth={2} /> : letter}
      </span>
      {presence && (
        <span
          className={`absolute -bottom-px -right-px size-[11px] rounded-full border-2 border-chat-surface ${PRESENCE[presence]}`}
        />
      )}
    </span>
  );
}
