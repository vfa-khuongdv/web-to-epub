// Stealth: the boss key that swaps the screen for a decoy, and the options around it.
// Pure helpers here; the behaviour lives in skins/StealthLayer.tsx.

export interface StealthPrefs {
  // Swap to the decoy when the window loses focus (alt-tab, a click into another app).
  hideOnBlur: boolean;
  // Skins show generic names (module-01/, part-0001.md) instead of story and chapter titles.
  neutralNames: boolean;
  // Desktop app only: the boss key also works while another app is focused.
  globalKey: boolean;
}

export const DEFAULT_STEALTH: StealthPrefs = { hideOnBlur: false, neutralNames: false, globalKey: false };

const STEALTH_KEY = "stealth";

export function readStealth(): StealthPrefs {
  try {
    const raw = localStorage.getItem(STEALTH_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<StealthPrefs>) : {};
    return {
      hideOnBlur: saved.hideOnBlur === true,
      neutralNames: saved.neutralNames === true,
      globalKey: saved.globalKey === true,
    };
  } catch {
    return { ...DEFAULT_STEALTH };
  }
}

export function saveStealth(prefs: StealthPrefs): void {
  try {
    localStorage.setItem(STEALTH_KEY, JSON.stringify(prefs));
  } catch {
    /* Applies for this session only */
  }
}

// Anything else in the app can ask for the decoy (the command palette's "Hide now") or
// react to it (a voice preview that must fall silent) through these window events, without
// a context reaching across the tree.
export const STEALTH_TOGGLE_EVENT = "stealth:toggle";
export const STEALTH_HIDE_EVENT = "stealth:hide";

export function requestStealthToggle(): void {
  window.dispatchEvent(new Event(STEALTH_TOGGLE_EVENT));
}

export type KeyLike = Pick<KeyboardEvent, "code" | "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

// Where a typed character belongs to what is being written, not to a shortcut. A field
// nobody can type into (the sheet skin's read-only formula bar) does not count, and a field
// marked `data-boss-key` (a command search, the fake terminal) gives the key to the boss key:
// nobody needs a backquote there, and hiding must not wait for the field to lose focus.
export function isTextEntry(target: EventTarget | null): boolean {
  if (!target || typeof (target as { tagName?: unknown }).tagName !== "string") return false;
  const el = target as HTMLElement;
  if (el.hasAttribute?.("data-boss-key")) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "select") return true;
  if (tag !== "input" && tag !== "textarea") return false;
  const field = el as HTMLInputElement | HTMLTextAreaElement;
  if (field.readOnly || field.disabled) return false;
  if (tag === "textarea") return true;
  const type = ((el as HTMLInputElement).type || "text").toLowerCase();
  return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image"].includes(type);
}

/**
 * The boss key is the key under Esc (backquote). Esc itself is taken: the reader, every
 * dialog and full screen close on it. Matched by physical key (`code`), because on many
 * layouts — and with Option on a Mac — that key produces a dead key or another character.
 * Ctrl/Cmd stay free (Ctrl+` is a terminal shortcut in real editors). While typing, the
 * key types; Alt+` hides from inside a text field.
 */
export function isBossKey(event: KeyLike, typing: boolean): boolean {
  if (event.code !== "Backquote" || event.ctrlKey || event.metaKey) return false;
  return typing ? event.altKey : true;
}

// Whether a blur is the user leaving the app, or the app itself opening something (a
// file picker, the export folder dialog, a link in the system browser) right after a
// click or key press. Those happen within moments of the gesture; alt-tab does not
// follow a press inside this page.
export const GESTURE_GRACE_MS = 1500;

export function blurIsOwnDialog(lastGestureAt: number, now: number): boolean {
  return now - lastGestureAt < GESTURE_GRACE_MS;
}
