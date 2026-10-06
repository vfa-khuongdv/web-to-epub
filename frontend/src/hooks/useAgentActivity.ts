import { useEffect, useState } from "react";
import { AgentActivityEvent, isAgentBusy } from "../lib/format/agentActivity";
import { currentVaultToken } from "../vault/token";

const MAX_EVENTS = 300;

type LiveMessage = { type: "snapshot"; events: AgentActivityEvent[] } | { type: "event"; event: AgentActivityEvent };

// Follows what the agent crawler is doing (routes/agentCrawler.ts, /api/agent-crawler/live): the recent
// history on connect, then each step. A dropped connection reconnects by itself and gets the history again.
export function useAgentActivity() {
  const [events, setEvents] = useState<AgentActivityEvent[]>([]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const token = currentVaultToken();
    const source = new EventSource(
      token ? `/api/agent-crawler/live?vault=${encodeURIComponent(token)}` : "/api/agent-crawler/live"
    );
    source.onmessage = (message) => {
      let data: LiveMessage;
      try {
        data = JSON.parse(message.data) as LiveMessage;
      } catch {
        return;
      }
      if (data.type === "snapshot") setEvents(data.events.slice(-MAX_EVENTS));
      else setEvents((current) => (current.some((e) => e.id === data.event.id) ? current : [...current, data.event].slice(-MAX_EVENTS)));
    };
    return () => source.close();
  }, []);

  return { events, busy: isAgentBusy(events) };
}
