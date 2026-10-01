import { useEffect, useState } from "react";
import { AiConfig, fetchAiConfig, saveAiConfig } from "../../lib/api";
import { useLang } from "../../i18n";

/**
 * AI crawler: which provider reads pages the app has no adapter for, and its key. The
 * provider list comes from the server, so a provider added there shows up here with no
 * change. The key field is never prefilled — the server does not send it back — and an
 * empty one keeps the saved key.
 */
// The home page shows its AI button from the same setting; it listens for this.
export const AI_CONFIG_CHANGED = "ai-config-changed";

export default function AiSettings({ onSaved, onError }: { onSaved: () => void; onError: (m: string) => void }) {
  const { t } = useLang();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAiConfig().then(setConfig).catch((err: Error) => onError(err.message));
  }, [onError]);

  const provider = config?.providers.find((p) => p.id === config.active);

  // Field values follow the provider being shown.
  useEffect(() => {
    setApiKey("");
    setModel(provider?.model ?? "");
    setBaseUrl(provider?.baseUrl ?? "");
  }, [provider?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(patch: Parameters<typeof saveAiConfig>[0]) {
    setBusy(true);
    try {
      await saveAiConfig(patch);
      setConfig(await fetchAiConfig());
      setApiKey("");
      window.dispatchEvent(new Event(AI_CONFIG_CHANGED));
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!config || !provider) return null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px]">{t("Crawl any site with AI")}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            {t(
              "For sites without built-in support, the AI picks the chapter list and the chapter text on the page. Page excerpts are sent to the provider you choose."
            )}
          </p>
        </div>
        <input
          type="checkbox"
          className="size-4 accent-select"
          aria-label={t("Crawl any site with AI")}
          checked={config.enabled}
          disabled={busy}
          onChange={(event) => void save({ enabled: event.target.checked })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <select
          className="input"
          aria-label={t("AI provider")}
          value={config.active}
          disabled={busy}
          onChange={(event) => void save({ active: event.target.value })}
        >
          {config.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.hasKey ? " ✓" : ""}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="password"
          autoComplete="off"
          aria-label={t("API key")}
          placeholder={provider.hasKey ? t("Key saved — type to replace") : t("API key")}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <input className="input" aria-label={t("Model")} placeholder={t("Model")} value={model} onChange={(e) => setModel(e.target.value)} />
        <input className="input" aria-label={t("Base URL")} placeholder={t("Base URL")} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <button
          type="button"
          className="btn self-start"
          disabled={busy}
          onClick={() => void save({ providers: { [provider.id]: { apiKey, model, baseUrl } } })}
        >
          {t("Save")}
        </button>
      </div>
    </>
  );
}
