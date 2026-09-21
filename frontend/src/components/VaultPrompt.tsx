import {
  FormEvent,
  MutableRefObject,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "./Icon";
import { Translate, useLang } from "../i18n";
import { VaultPromptMode } from "../vault";

export const CODE_LENGTH = 6;

/**
 * Six boxes, one digit each. The code is still a plain string in state — the boxes
 * only read `value[i]`, so it can never drift out of step with what is typed, and
 * a code is always filled left to right with no holes in the middle.
 *
 * Exported for the settings page, which asks for the same kind of code when changing
 * it — one code box in the app, not two that drift apart.
 */
export function PinInput({
  id,
  label,
  value,
  onChange,
  onComplete,
  disabled,
  firstBox,
  t,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  // Called once the sixth digit lands, so setup can walk on to the "repeat" row.
  onComplete?: () => void;
  disabled?: boolean;
  // The first box, so the card can put the caret back on a row after an error.
  firstBox?: MutableRefObject<HTMLInputElement | null>;
  t: Translate;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  const focusBox = (index: number) =>
    boxes.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))]?.focus();

  function handleChange(index: number, raw: string) {
    // Pasting the whole code into any box fills the rest of the row from there.
    const typed = raw.replace(/\D/g, "");
    if (!typed) return;
    const at = Math.min(index, value.length);
    const next = (value.slice(0, at) + typed + value.slice(at + typed.length)).slice(0, CODE_LENGTH);
    onChange(next);
    focusBox(at + typed.length);
    if (next.length === CODE_LENGTH) onComplete?.();
  }

  function handleKeyDown(index: number, event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      // Always eats the last digit, wherever the caret is: with one character per box
      // there is nothing to delete "behind" the caret, and this is what a PIN pad does.
      event.preventDefault();
      if (!value) return;
      onChange(value.slice(0, -1));
      focusBox(value.length - 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  return (
    <div className="field">
      <label htmlFor={`${id}-0`}>{label}</label>
      <div className="vault-pin" role="group" aria-label={label}>
        {Array.from({ length: CODE_LENGTH }, (_, index) => (
          <input
            key={index}
            id={`${id}-${index}`}
            ref={(element) => {
              boxes.current[index] = element;
              if (index === 0 && firstBox) firstBox.current = element;
            }}
            className="input vault-pin-box"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            aria-label={t("Digit {position}", { position: index + 1 })}
            value={value[index] ?? ""}
            disabled={disabled}
            // Clicking past the end lands on the first empty box instead. This has to
            // hang off mousedown, not focus: auto-advance moves focus before React has
            // re-rendered with the digit just typed, so a focus-time check still sees
            // the old length and would bounce the caret back over it.
            onMouseDown={(event) => {
              if (index <= value.length) return;
              event.preventDefault();
              focusBox(value.length);
            }}
            // Typing into a filled box replaces it rather than appending.
            onFocus={(event) => event.target.select()}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The only thing private mode shows before it is open: a code box.
 *
 * The digits are masked while typing, and setup asks for the code twice — a typo in a
 * code nobody can recover would lock the library away for good.
 */
export default function VaultPrompt({
  mode,
  onSubmit,
  onCancel,
}: {
  mode: VaultPromptMode;
  onSubmit: (code: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLang();
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeBox = useRef<HTMLInputElement | null>(null);
  const confirmBox = useRef<HTMLInputElement | null>(null);

  // Which row to put the caret back on after an error. It cannot be focused on the
  // spot: the boxes are disabled while the server checks the code, and a disabled
  // input takes no focus — so it waits for the card to come back to life.
  const [refocus, setRefocus] = useState<"code" | "confirm" | null>("code");

  useEffect(() => {
    if (!refocus || busy) return;
    (refocus === "code" ? codeBox : confirmBox).current?.focus();
    setRefocus(null);
  }, [refocus, busy]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const ready = code.length === CODE_LENGTH && (mode === "unlock" || confirm.length === CODE_LENGTH);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    if (mode === "setup" && code !== confirm) {
      setError(t("The two codes do not match"));
      setConfirm("");
      setRefocus("confirm");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code);
    } catch (err) {
      setError((err as Error).message);
      setCode("");
      setConfirm("");
      setRefocus("code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vault-scrim" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <form
        className="vault-card"
        role="dialog"
        aria-modal="true"
        aria-label={t("Private mode")}
        onSubmit={handleSubmit}
      >
        <h2 className="vault-title">
          <Icon name="lock" size={14} />
          {mode === "setup" ? t("Set a code for private mode") : t("Private mode")}
        </h2>
        <p className="vault-note">
          {mode === "setup"
            ? t("Pick a 6-digit code. There is no way to recover it; you can change it later in Settings.")
            : t("Enter your 6-digit code to open your private library.")}
        </p>

        <PinInput
          id="vault-code"
          label={mode === "setup" ? t("New code") : t("Code")}
          value={code}
          onChange={setCode}
          onComplete={mode === "setup" ? () => confirmBox.current?.focus() : undefined}
          disabled={busy}
          firstBox={codeBox}
          t={t}
        />

        {mode === "setup" && (
          <PinInput
            id="vault-confirm"
            label={t("Repeat the code")}
            value={confirm}
            onChange={setConfirm}
            disabled={busy}
            firstBox={confirmBox}
            t={t}
          />
        )}

        {error && (
          <p className="vault-error" role="alert">
            <Icon name="alert" size={13} />
            {error}
          </p>
        )}

        <div className="vault-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ready || busy}>
            {busy ? t("Opening…") : mode === "setup" ? t("Create") : t("Open")}
          </button>
        </div>
      </form>
    </div>
  );
}
