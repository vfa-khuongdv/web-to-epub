import { FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useLang } from "../i18n";
import { VaultPromptMode } from "../vault";

const CODE_LENGTH = 6;
const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, CODE_LENGTH);

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
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

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
      firstField.current?.focus();
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
            ? t("Pick a 6-digit code. There is no way to recover it, and no way to change it later.")
            : t("Enter your 6-digit code to open your private library.")}
        </p>

        <div className="field">
          <label htmlFor="vault-code">{mode === "setup" ? t("New code") : t("Code")}</label>
          <input
            id="vault-code"
            ref={firstField}
            className="input vault-code"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={CODE_LENGTH}
            value={code}
            disabled={busy}
            onChange={(event) => setCode(digitsOnly(event.target.value))}
          />
        </div>

        {mode === "setup" && (
          <div className="field">
            <label htmlFor="vault-confirm">{t("Repeat the code")}</label>
            <input
              id="vault-confirm"
              className="input vault-code"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={CODE_LENGTH}
              value={confirm}
              disabled={busy}
              onChange={(event) => setConfirm(digitsOnly(event.target.value))}
            />
          </div>
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
