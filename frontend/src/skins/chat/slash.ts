// The composer's slash commands: "/" opens a list of them, as in the chat, and Enter runs
// the one picked. Plain text is never sent anywhere — the shell only shows it locally.

export interface SlashCommand {
  name: string;
  description: string;
  run: () => void;
}

// The word being typed after a leading "/", or null when the draft is not a command
// (plain text, or a command already followed by a space).
export function slashQuery(draft: string): string | null {
  const match = /^\/(\S*)$/.exec(draft);
  return match ? match[1].toLowerCase() : null;
}

// Commands starting with the query first, then those that only contain it.
export function matchSlash<T extends { name: string }>(commands: T[], query: string): T[] {
  const q = query.toLowerCase();
  const starts = commands.filter((command) => command.name.startsWith(q));
  const contains = commands.filter((command) => !command.name.startsWith(q) && command.name.includes(q));
  return [...starts, ...contains];
}

// What Enter does with a draft: run a command (`/next` with its exact name, or the one
// highlighted in the list), say a command is unknown, or show the text as a message.
export type DraftAction<T> =
  | { kind: "run"; command: T }
  | { kind: "unknown"; name: string }
  | { kind: "message"; text: string }
  | { kind: "none" };

export function draftAction<T extends { name: string }>(
  draft: string,
  commands: T[],
  highlighted: T | undefined
): DraftAction<T> {
  const text = draft.trim();
  if (!text) return { kind: "none" };
  if (text.startsWith("/")) {
    const name = text.slice(1).split(/\s+/)[0].toLowerCase();
    const exact = commands.find((command) => command.name === name);
    if (exact) return { kind: "run", command: exact };
    if (highlighted && slashQuery(text) !== null) return { kind: "run", command: highlighted };
    return { kind: "unknown", name: `/${name}` };
  }
  return { kind: "message", text };
}
