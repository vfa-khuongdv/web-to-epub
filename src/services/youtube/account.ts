import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "../../config/paths";
import { t } from "../lang";
import { expandHome } from "./config";

/**
 * The user's own Google account: an OAuth client they created, and the tokens from the
 * browser sign-in. Install-wide (DATA_DIR/youtube/account.json, mode 0600) like the saved
 * site sessions — one channel, not one per library. The app never sees a password.
 *
 * Plain fetch, no googleapis package: the flow is a loopback redirect with PKCE, which a
 * Desktop-type OAuth client accepts on any port (the Electron app picks a free one).
 */
export interface YouTubeAccount {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number; // ms since epoch
  channelId?: string;
  channelTitle?: string;
  savedAt: string;
}

export interface ClientSecret {
  clientId: string;
  clientSecret: string;
}

export type FetchLike = typeof fetch;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
];

export function accountPath(): string {
  return path.join(DATA_DIR, "youtube", "account.json");
}

export async function loadAccount(): Promise<YouTubeAccount | undefined> {
  try {
    return JSON.parse(await fs.readFile(accountPath(), "utf8")) as YouTubeAccount;
  } catch {
    return undefined;
  }
}

export async function saveAccount(account: YouTubeAccount): Promise<void> {
  const file = accountPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(account), { mode: 0o600 });
}

export async function removeAccount(): Promise<void> {
  await fs.rm(accountPath(), { force: true });
}

// The JSON Google Cloud hands out for a Desktop app client ("installed") or a Web client
// ("web"); accept either, and a flat {client_id, client_secret} too.
export async function readClientSecret(filePath: string): Promise<ClientSecret> {
  const resolved = expandHome(filePath);
  let raw: string;
  try {
    raw = await fs.readFile(resolved, "utf8");
  } catch {
    throw new Error(t("Could not read the OAuth client file: {path}", { path: resolved }));
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(t("That file is not a Google OAuth client JSON"));
  }
  const node = (json.installed ?? json.web ?? json) as Record<string, unknown>;
  const clientId = node.client_id ?? node.clientId;
  const clientSecret = node.client_secret ?? node.clientSecret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string" || !clientId || !clientSecret) {
    throw new Error(t("That file is not a Google OAuth client JSON"));
  }
  return { clientId, clientSecret };
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authUrl(params: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline",
    // Always hand back a refresh token, even when this client signed in before.
    prompt: "consent",
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${query.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function tokenRequest(body: URLSearchParams, fetchImpl: FetchLike): Promise<TokenResponse> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    const reason = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(t("Google refused the sign-in: {reason}", { reason }));
  }
  return data;
}

export async function exchangeCode(
  params: { clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string },
  fetchImpl: FetchLike = fetch
): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
      code_verifier: params.verifier,
    }),
    fetchImpl
  );
}

// A valid access token, refreshed and saved when it is close to expiring.
export async function accessToken(account: YouTubeAccount, fetchImpl: FetchLike = fetch): Promise<string> {
  if (account.accessToken && account.expiresAt && account.expiresAt > Date.now() + 60_000) {
    return account.accessToken;
  }
  if (!account.refreshToken) {
    throw new Error(t("Not signed in to YouTube — connect the account in Settings → YouTube"));
  }
  const data = await tokenRequest(
    new URLSearchParams({
      client_id: account.clientId,
      client_secret: account.clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }),
    fetchImpl
  );
  account.accessToken = data.access_token;
  account.expiresAt = Date.now() + data.expires_in * 1000;
  await saveAccount(account);
  return data.access_token;
}

export async function fetchChannel(
  token: string,
  fetchImpl: FetchLike = fetch
): Promise<{ id: string; title: string } | undefined> {
  const res = await fetchImpl("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return undefined;
  const data = (await res.json().catch(() => ({}))) as {
    items?: { id?: string; snippet?: { title?: string } }[];
  };
  const item = data.items?.[0];
  if (!item?.id) return undefined;
  return { id: item.id, title: item.snippet?.title ?? "" };
}
