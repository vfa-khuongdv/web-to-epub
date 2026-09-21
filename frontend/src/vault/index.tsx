/**
 * Private mode: a second library, behind a six-digit code.
 *
 * There is no button for it anywhere in the UI — Cmd/Ctrl+Shift+N opens it, and the
 * same keys close it again. The first time, the user picks the code; after that they
 * type it. While it is open every request carries the session token (see
 * vaultToken.ts), so the server reads and writes data/private/ instead of the normal
 * library, and everything else in the app behaves exactly as it always does.
 *
 * Chrome and Edge keep Cmd/Ctrl+Shift+N for their own incognito window and a page
 * never sees the keypress, so Cmd/Ctrl+Shift+K opens it too. In the packaged app
 * (Electron) and in Safari the documented shortcut works.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { closeVault, fetchVaultStatus, openVault } from "../lib/api";
import { forgetPrivatePositions, setPrivateScope } from "../lib/readerPreview";
import { onVaultExpired, setVaultToken } from "./token";
import VaultPrompt from "../components/VaultPrompt";

// "setup" the first time (pick a code and confirm it), "unlock" every time after.
export type VaultPromptMode = "setup" | "unlock";

interface VaultValue {
  // True while the private library is the one on screen.
  active: boolean;
  prompt: VaultPromptMode | null;
  // Open the prompt, or — when private mode is already on — leave it.
  toggle(): void;
  cancel(): void;
  submit(code: string): Promise<void>;
  leave(): void;
}

const VaultContext = createContext<VaultValue>({
  active: false,
  prompt: null,
  toggle: () => {},
  cancel: () => {},
  submit: async () => {},
  leave: () => {},
});

function isToggleKey(event: KeyboardEvent): boolean {
  if (!event.shiftKey || !(event.metaKey || event.ctrlKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  return key === "n" || key === "k";
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [prompt, setPrompt] = useState<VaultPromptMode | null>(null);

  // Everything the browser remembers about the private library, dropped together:
  // reading positions are per-browser (see readerPreview.ts) and would otherwise
  // outlive the session that made them.
  const forget = useCallback(() => {
    setVaultToken(null);
    setPrivateScope(false);
    forgetPrivatePositions();
    setActive(false);
    setPrompt(null);
  }, []);

  const leave = useCallback(() => {
    void closeVault();
    forget();
  }, [forget]);

  // The server drops a session it has not seen in hours; when a request finds that
  // out, fall back to the normal library rather than failing every later request.
  useEffect(() => {
    onVaultExpired(forget);
    return () => onVaultExpired(null);
  }, [forget]);

  const toggle = useCallback(() => {
    if (active) {
      leave();
      return;
    }
    // Asked for only when the shortcut is pressed: an app that never opens private
    // mode never sends a request that hints the feature exists.
    fetchVaultStatus()
      .then((status) => setPrompt(status.configured ? "unlock" : "setup"))
      .catch(() => setPrompt("unlock"));
  }, [active, leave]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isToggleKey(event)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const submit = useCallback(
    async (code: string) => {
      const mode = prompt ?? "unlock";
      const token = await openVault(code, mode);
      setVaultToken(token);
      setPrivateScope(true);
      setActive(true);
      setPrompt(null);
    },
    [prompt]
  );

  const value = useMemo<VaultValue>(
    () => ({ active, prompt, toggle, cancel: () => setPrompt(null), submit, leave }),
    [active, prompt, toggle, submit, leave]
  );

  return (
    <VaultContext.Provider value={value}>
      {children}
      {prompt && <VaultPrompt mode={prompt} onSubmit={submit} onCancel={() => setPrompt(null)} />}
    </VaultContext.Provider>
  );
}

export function useVault(): VaultValue {
  return useContext(VaultContext);
}
