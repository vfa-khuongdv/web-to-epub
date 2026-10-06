// The chat skin's window-wide keys. Alt+↑/↓ move between threads even from the composer
// (the chat's own "previous/next conversation" keys); [ and ] do the same when no text
// field has focus. F1 and Ctrl/Cmd+K open the search box's command list.

export type ChatKeyAction = "palette" | "next" | "previous";

export type KeyInput = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

export function chatKeyAction(event: KeyInput, typing: boolean): ChatKeyAction | null {
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === "F1") return mod || event.altKey || event.shiftKey ? null : "palette";
  // By physical key, so a Vietnamese input method or another layout does not move it.
  const isK = event.code === "KeyK" || (!event.code && event.key.toLowerCase() === "k");
  if (mod && isK && !event.altKey && !event.shiftKey) return "palette";
  if (event.altKey && !mod && !event.shiftKey) {
    if (event.key === "ArrowDown") return "next";
    if (event.key === "ArrowUp") return "previous";
    return null;
  }
  if (typing || mod || event.altKey) return null;
  if (event.key === "]") return "next";
  if (event.key === "[") return "previous";
  return null;
}
