// The code-hosting skin's keyboard shortcuts, in the site's own spirit: "/" or "s" (and
// Ctrl/Cmd+K) for the command palette, "g" then a letter to jump between sections, "t" to
// find a file, and [ ] or j k to step through files. Pure, so the mapping is tested alone;
// the hook in RepoShell feeds it keydown events from outside text fields.

export type RepoPlace = "home" | "repo" | "blob";

export type KeyAction =
  | "palette"
  | "next"
  | "previous"
  | "up"
  | "find-file"
  | "go-home"
  | "go-code"
  | "go-issues"
  | "go-pulls"
  | "go-actions"
  | "go-settings";

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

// After "g", the next letter picks a section, as the site's "g c", "g i", "g p" do.
const AFTER_G: Record<string, KeyAction> = {
  d: "go-home",
  c: "go-code",
  i: "go-issues",
  p: "go-pulls",
  a: "go-actions",
  s: "go-settings",
};

// Sections that need an open repository.
const IN_REPO = new Set<KeyAction>(["go-code", "go-issues", "go-pulls", "go-actions", "go-settings"]);

/**
 * What a key does in the given place, and whether a "g" is now waiting for its letter.
 * Modified keys are left to the browser, except Ctrl/Cmd+K (the palette).
 */
export function keyAction(input: KeyInput, state: { place: RepoPlace; pendingG: boolean }): {
  action: KeyAction | null;
  pendingG: boolean;
} {
  const { key, ctrlKey, metaKey, altKey } = input;
  const none = { action: null, pendingG: false };
  if (ctrlKey || metaKey) {
    return !altKey && key.toLowerCase() === "k" ? { action: "palette", pendingG: false } : none;
  }
  if (altKey) return none;

  if (state.pendingG) {
    const action = AFTER_G[key.toLowerCase()] ?? null;
    if (!action || (IN_REPO.has(action) && state.place === "home")) return none;
    return { action, pendingG: false };
  }

  if (key === "g") return { action: null, pendingG: true };
  if (key === "/" || key === "s") return { action: "palette", pendingG: false };
  if (state.place === "repo" && key === "t") return { action: "find-file", pendingG: false };
  if (state.place === "blob") {
    if (key === "]" || key === "j") return { action: "next", pendingG: false };
    if (key === "[" || key === "k") return { action: "previous", pendingG: false };
    if (key === "Escape") return { action: "up", pendingG: false };
  }
  return none;
}
