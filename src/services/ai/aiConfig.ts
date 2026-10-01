import { settingsStore } from "../settingsStore";
import { AiProvider, createProvider, findProvider, ProviderConfig } from "./providers";

export interface AiConfig {
  enabled: boolean;
  // The provider crawls use; the others can stay configured so switching is one click.
  active: string;
  providers: Record<string, ProviderConfig>;
}

const KEY = "aiConfig";
const EMPTY: AiConfig = { enabled: false, active: "deepseek", providers: {} };

export function loadAiConfig(): AiConfig {
  try {
    const raw = settingsStore.getRaw(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

export function saveAiConfig(config: AiConfig): void {
  settingsStore.setRaw(KEY, JSON.stringify(config));
}

// The provider to crawl with, or undefined when the feature is off or has no usable key.
export function activeAiProvider(): AiProvider | undefined {
  const config = loadAiConfig();
  if (!config.enabled) return undefined;
  const info = findProvider(config.active);
  const providerConfig = config.providers[config.active];
  if (!info || !providerConfig) return undefined;
  if (info.keyRequired && !providerConfig.apiKey) return undefined;
  return createProvider(config.active, providerConfig);
}
