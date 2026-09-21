import { Request as ExpressRequest, Response as ExpressResponse, Router } from "express";
import { ProgressEvent } from "../types";
import { Library, libraryFor } from "./library";

export const liveRouter = Router();

export function writeSse(res: ExpressResponse, payload: unknown) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}

// Crawls in progress per story, with current position so a session opened mid-crawl
// knows exactly where it is (see /stories/:id/live). Sessions listening per story are
// in `liveSubscribers`; `liveAllSubscribers` is the shared channel every open session
// joins, so the library table can show a "Crawling" chip on rows nobody selected. The
// crawl outlives the request that started it, so a reloaded session still sees it.
export function publish(library: Library, storyId: string, event: ProgressEvent) {
  const subs = library.liveSubscribers.get(storyId);
  if (subs) {
    for (const res of subs) {
      if (!writeSse(res, event)) subs.delete(res);
    }
  }
  if (library.liveAllSubscribers.size === 0) return;
  const tagged = { ...event, storyId };
  for (const res of library.liveAllSubscribers) {
    if (!writeSse(res, tagged)) library.liveAllSubscribers.delete(res);
  }
}

function startSse(res: ExpressResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 2000\n\n");
}

// Keep the connection alive through proxies and signal to the client that the server
// is still there. Returns the cleanup to run when the request closes.
function keepAlive(req: ExpressRequest, res: ExpressResponse): () => void {
  const beat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
  }, 20_000);
  return () => clearInterval(beat);
}

// Shared live channel: snapshot of all running crawls on connect, then all events with
// `storyId` — enough for the library table to know which stories are crawling without
// needing to select one. Must be mounted before /stories/:id so "live" isn't an ID.
liveRouter.get("/stories/live", (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  startSse(res);
  res.write(
    `data: ${JSON.stringify({
      type: "snapshot",
      crawls: [...library.runningCrawls.entries()].map(([storyId, state]) => ({ storyId, ...state })),
    })}\n\n`
  );

  library.liveAllSubscribers.add(res);
  const stopBeat = keepAlive(req, res);

  req.on("close", () => {
    stopBeat();
    library.liveAllSubscribers.delete(res);
  });
});

// Live channel for one story: every crawl change is pushed to sessions viewing it — no
// reload, no polling needed. On connect, new sessions immediately get a snapshot
// (crawl position or idle state).
liveRouter.get("/stories/:id/live", (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { id } = req.params;
  startSse(res);

  const current = library.runningCrawls.get(id);
  const snapshot: ProgressEvent = current
    ? { type: "running", cursor: current.cursor, total: current.total }
    : { type: "idle" };
  res.write(`data: ${JSON.stringify(snapshot)}\n\n`);

  const subs = library.liveSubscribers.get(id) ?? new Set<ExpressResponse>();
  subs.add(res);
  library.liveSubscribers.set(id, subs);

  const stopBeat = keepAlive(req, res);

  req.on("close", () => {
    stopBeat();
    subs.delete(res);
    if (subs.size === 0) library.liveSubscribers.delete(id);
  });
});
