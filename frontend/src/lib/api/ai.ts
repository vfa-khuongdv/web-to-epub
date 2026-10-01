import { apiFetch, langHeaders, readJsonError, tr } from "./http";

export interface AiProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  keyRequired: boolean;
  // The server never sends a saved key back, only whether one is set.
  hasKey: boolean;
}

export interface AiConfig {
  enabled: boolean;
  active: string;
  providers: AiProviderInfo[];
}

export interface AiConfigPatch {
  enabled?: boolean;
  active?: string;
  providers?: Record<string, { apiKey?: string; baseUrl?: string; model?: string }>;
}

export async function fetchAiConfig(): Promise<AiConfig> {
  const res = await apiFetch("/api/ai/config", { headers: langHeaders() });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not load the AI settings")));
  return (await res.json()) as AiConfig;
}

export async function saveAiConfig(patch: AiConfigPatch): Promise<void> {
  const res = await apiFetch("/api/ai/config", {
    method: "PUT",
    headers: langHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readJsonError(res, tr("Could not save the AI settings")));
}
