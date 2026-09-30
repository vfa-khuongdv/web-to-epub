import { apiError, langHeaders, readJsonError, tr } from "./http";

export interface VaultStatus {
  configured: boolean;
}

export async function fetchVaultStatus(): Promise<VaultStatus> {
  const res = await fetch("/api/vault/status", { headers: langHeaders() });
  if (!res.ok) throw new Error(tr("Could not check private mode"));
  return (await res.json()) as VaultStatus;
}

// Both halves of "open private mode": the first time there is no code yet and the user
// picks one, afterwards they type the one they picked. Either way the answer is a
// session token.
export async function openVault(code: string, mode: "setup" | "unlock"): Promise<string> {
  const res = await fetch(`/api/vault/${mode}`, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw apiError(await readJsonError(res, tr("Wrong code")), res.status);
  return ((await res.json()) as { token: string }).token;
}

// Replacing the code proves the current one, so this works from the settings page
// whether or not private mode is open right now. Open sessions keep working.
export async function changeVaultCode(code: string, newCode: string): Promise<void> {
  const res = await fetch("/api/vault/change-code", {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ code, newCode }),
  });
  if (!res.ok) throw apiError(await readJsonError(res, tr("Wrong code")), res.status);
}

export async function closeVault(): Promise<void> {
  // A failure here only means the server keeps a token nobody will send again; the
  // client forgets it regardless, so there is nothing for the user to act on.
  await fetch("/api/vault/lock", { method: "POST", headers: langHeaders() }).catch(() => undefined);
}
