import { useCallback, useEffect, useState } from "react";
import { fetchPlotTwistState, PlotTwistState, startPlotTwist, stopPlotTwist } from "../../lib/api";
import { useLang } from "../../i18n";
import { Icon } from "../ui/Icon";

/**
 * Asks the agent to find the plot twists a narrated story really has and write them up as
 * one "Plot twist" chapter placed first. The job runs on the server; this polls it.
 */
export default function PlotTwistPanel({ storyId, onWritten }: { storyId: string; onWritten: () => void | Promise<void> }) {
  const { t } = useLang();
  const [state, setState] = useState<PlotTwistState | null>(null);
  const [error, setError] = useState("");
  const running = state?.run?.status === "running";

  const load = useCallback(async () => {
    try {
      setState(await fetchPlotTwistState(storyId));
    } catch {
      setState(null);
    }
  }, [storyId]);

  useEffect(() => {
    setState(null);
    setError("");
    void load();
  }, [load]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      fetchPlotTwistState(storyId).then(
        (next) => {
          setState(next);
          if (next.run?.status === "done") void onWritten();
        },
        () => undefined
      );
    }, 3000);
    return () => clearInterval(timer);
  }, [running, storyId, onWritten]);

  if (!state?.narratable) return null;

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const failure = error || (state.run?.status === "error" ? state.run.error : "");
  return (
    <div className="field">
      <span className="label">{t("Plot twist chapter")}</span>
      <p className="text-[12px] leading-snug text-ink-3">
        {t("The agent finds the plot twists this story has and writes one chapter that retells them, placed first so the audio opens with it.")}
      </p>
      {state.ready ? (
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <>
              <span className="text-[12px] text-ink-2">
                {state.run?.step === "write"
                  ? t("Writing the chapter…")
                  : t("Looking for plot twists… {done}/{total}", { done: state.run?.done ?? 0, total: state.run?.total ?? 0 })}
              </span>
              <button type="button" className="btn btn-tiny" onClick={() => void run(() => stopPlotTwist(storyId))}>
                {t("Stop")}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-tiny self-start" onClick={() => void run(() => startPlotTwist(storyId))}>
              <Icon name="sparkles" size={13} />
              {state.exists ? t("Write the plot twist chapter again") : t("Write a plot twist chapter")}
            </button>
          )}
        </div>
      ) : (
        <span className="text-[12px] text-ink-3">{t("Turn the agent crawler on in Settings first.")}</span>
      )}
      {failure && (
        <p role="status" className="text-[12px] leading-snug text-error">
          {failure}
        </p>
      )}
    </div>
  );
}
