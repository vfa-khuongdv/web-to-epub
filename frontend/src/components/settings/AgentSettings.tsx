import { useEffect, useState } from "react";
import { AgentConfig, fetchAgentConfig, saveAgentConfig } from "../../lib/api";
import { useLang } from "../../i18n";

/**
 * Agent crawler: a coding agent already installed on this computer writes the crawler for a site the
 * app has no adapter for. The checkbox turns it on; the installed agents are looked up by the server
 * on every load, and the person picks which one to ask. Nothing to configure otherwise — the agent
 * uses its own sign-in.
 */
// The home page shows its agent button from the same setting; it listens for this.
export const AGENT_CONFIG_CHANGED = "agent-config-changed";

export default function AgentSettings({ onSaved, onError }: { onSaved: () => void; onError: (m: string) => void }) {
  const { t } = useLang();
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchAgentConfig()
      .then((c) => {
        setConfig(c);
        setModel(c.model);
      })
      .catch((err: Error) => {
        setFailed(true);
        onError(err.message);
      });
  }, [onError]);

  async function save(patch: Parameters<typeof saveAgentConfig>[0]) {
    setBusy(true);
    try {
      await saveAgentConfig(patch);
      const next = await fetchAgentConfig();
      setConfig(next);
      setModel(next.model);
      window.dispatchEvent(new Event(AGENT_CONFIG_CHANGED));
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return <p className="text-[12px] text-ink-3">{failed ? t("Could not load the agent crawler settings") : t("Loading…")}</p>;
  }
  const installed = config.agents.filter((a) => a.installed);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px]">{t("Crawl any site with an agent")}</div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            {t(
              "For sites without built-in support, a coding agent installed on this computer (opencode, Claude Code, Codex) writes the crawler for the site once; the app then runs it for every chapter. Page excerpts are sent to that agent's model."
            )}
          </p>
        </div>
        <input
          type="checkbox"
          className="size-4 accent-select"
          aria-label={t("Crawl any site with an agent")}
          checked={config.enabled}
          disabled={busy || (!config.enabled && installed.length === 0)}
          onChange={(event) => void save({ enabled: event.target.checked })}
        />
      </div>

      {installed.length === 0 ? (
        <p className="text-[12px] leading-snug text-ink-3">
          {t("No agent found on this computer. Install opencode, Claude Code or Codex and sign in, then reopen Settings.")}
        </p>
      ) : (
        config.enabled && (
          <div className="flex flex-col gap-2">
            <select
              className="input"
              aria-label={t("Agent")}
              value={config.agent ?? ""}
              disabled={busy}
              onChange={(event) => void save({ agent: event.target.value })}
            >
              {config.agents.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.installed}>
                  {a.installed ? a.name : `${a.name} — ${t("not installed")}`}
                </option>
              ))}
            </select>
            <input
              className="input"
              aria-label={t("Model")}
              placeholder={t("Model (empty = the agent's default)")}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              onBlur={() => model !== config.model && void save({ model })}
            />
          </div>
        )
      )}
    </>
  );
}
