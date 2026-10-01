import { currentLang, translate } from "../../i18n";
import { currentVaultToken, noteVaultExpired } from "../../vault/token";
import { StoredStory } from "../../types";

// api.ts is not a component, so it reads the language straight from storage rather
// than the context.
export const tr = (key: string) => translate(currentLang(), key);

// The server phrases its own errors, and they are shown to the user verbatim, so every
// request carries the language it should answer in. It also carries the private-mode
// token when one is held: that is what tells the server which library to read — no
// token means the normal one.
export function langHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = currentVaultToken();
  const headers: Record<string, string> = { ...extra, "X-Lang": currentLang() };
  if (token) headers["X-Vault-Token"] = token;
  return headers;
}

// Every call goes through here so an expired private session is noticed once, in one
// place: the server answers 401 to a token it no longer knows, and the app drops back
// to the normal library instead of every later request failing on its own.
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const hadToken = currentVaultToken() !== null;
  const res = await fetch(path, init);
  if (res.status === 401 && hadToken) noteVaultExpired();
  return res;
}

// Errors the UI has to react to by kind, not by wording — matching the message text
// would break the moment it is translated.
export interface ApiError extends Error {
  status?: number;
  // "exists" on an import whose file is already in the library.
  code?: string;
  story?: StoredStory;
}

export function apiError(message: string, status: number, code?: string, story?: StoredStory): ApiError {
  const error: ApiError = new Error(message);
  error.status = status;
  error.code = code;
  error.story = story;
  return error;
}

export async function readJsonError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.message || fallback;
}

export async function streamNdjson<T>(path: string, body: unknown, onEvent: (event: T) => void): Promise<void> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new Error(await readJsonError(res, tr("Crawl failed")));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line));
    }
  }
}
