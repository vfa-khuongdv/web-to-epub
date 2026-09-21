/**
 * The private-mode session token.
 *
 * api.ts is not a component and cannot read the React context, but every request has
 * to say which library it wants — the same reason `currentLang()` exists. Unlike the
 * language this is deliberately NOT written to localStorage: closing the tab (or the
 * app) has to leave the private library locked, and a token in storage would both
 * survive that and leave a trace that the feature is in use at all.
 */
let token: string | null = null;
let expiredHandler: (() => void) | null = null;

export function currentVaultToken(): string | null {
  return token;
}

export function setVaultToken(next: string | null): void {
  token = next;
}

// Called by the provider so it can drop back to the normal library when the server
// says the session is gone.
export function onVaultExpired(handler: (() => void) | null): void {
  expiredHandler = handler;
}

// api.ts calls this when a request that carried a token comes back 401.
export function noteVaultExpired(): void {
  token = null;
  expiredHandler?.();
}

// For the two things the browser opens without headers — EventSource and <img src>.
export function vaultQuery(): string {
  return token ? `&vault=${encodeURIComponent(token)}` : "";
}
