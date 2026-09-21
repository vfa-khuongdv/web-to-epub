import { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { CoverStore, createCoverStore } from "../services/coverStore";
import { StoryStore, createStoryStore, storyStore } from "../services/storyStore";
import { vault } from "../services/vault";
import { t } from "../services/lang";
import { DATA_DIR, PRIVATE_DIR } from "../config/paths";

/**
 * A library the app can be reading and writing: the normal one, or the private one
 * the user unlocks with their code (its own stories.db + covers/ under data/private/).
 * Every route picks one per request, so a query on the normal library cannot return a
 * private story even if someone later forgets a filter.
 */
export interface Library {
  dataDir: string;
  stories: StoryStore;
  covers: CoverStore;
  // Crawl state belongs to the library too: a story id is sha1 of its URL, so the same
  // story saved in both libraries shares an id and their events would cross.
  runningCrawls: Map<string, { cursor: number; total: number; startedAt: number; etaMs?: number }>;
  liveSubscribers: Map<string, Set<ExpressResponse>>;
  liveAllSubscribers: Set<ExpressResponse>;
}

function createLibrary(dataDir: string, stories: StoryStore): Library {
  return {
    dataDir,
    stories,
    covers: createCoverStore(dataDir),
    runningCrawls: new Map(),
    liveSubscribers: new Map(),
    liveAllSubscribers: new Set(),
  };
}

const publicLibrary = createLibrary(DATA_DIR, storyStore);

// Built the first time someone actually unlocks, so a user who never opens private
// mode never ends up with a data/private/ directory.
let privateLibrary: Library | undefined;
function getPrivateLibrary(): Library {
  return (privateLibrary ??= createLibrary(PRIVATE_DIR, createStoryStore(PRIVATE_DIR)));
}

/**
 * Which library this request is talking to. It asks for the private one by carrying
 * the token from /vault/unlock — normally in a header, in the query string for the two
 * things the browser opens without headers (EventSource and <img src>).
 *
 * A stale or forged token must never quietly fall back to the normal library — that
 * would show the wrong shelf, or worse, save a private story into the public one — so
 * this answers 401 itself and returns null for the caller to bail on.
 */
export function libraryFor(req: ExpressRequest, res: ExpressResponse): Library | null {
  const token = req.header("X-Vault-Token") ?? (typeof req.query.vault === "string" ? req.query.vault : undefined);
  if (!token) return publicLibrary;
  if (!vault.isValidToken(token)) {
    res.status(401).json({ message: t("Private mode has locked — enter your code again") });
    return null;
  }
  return getPrivateLibrary();
}
