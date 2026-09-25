import { Router } from "express";
import { SUPPORTED_SITES } from "../config/supportedSites";
import { setLang } from "../services/lang";
import { appUpdateRouter } from "./appUpdate";
import { chaptersRouter } from "./chapters";
import { crawlRouter } from "./crawl";
import { exportsRouter } from "./exports";
import { highlightsRouter } from "./highlights";
import { liveRouter } from "./live";
import { narrationRouter } from "./narration";
import { settingsRouter } from "./settings";
import { siteSessionsRouter } from "./siteSessions";
import { storiesRouter } from "./stories";
import { ttsRouter } from "./tts";
import { vaultRouter } from "./vault";

const router = Router();

// The frontend states the reader's language on every request; the server phrases its
// errors in it (see services/lang.ts for why this is module state, not per-request).
router.use((req, _res, next) => {
  setLang(req.header("X-Lang") ?? undefined);
  next();
});

router.get("/supported-sites", (_req, res) => {
  res.json({ sites: SUPPORTED_SITES });
});

router.use(vaultRouter);
router.use(settingsRouter);
router.use(appUpdateRouter);
router.use(ttsRouter);
router.use(siteSessionsRouter);
router.use(exportsRouter);
// Mounted before storiesRouter: GET /stories/live would otherwise match GET /stories/:id
// with "live" as the story id.
router.use(liveRouter);
router.use(narrationRouter);
router.use(storiesRouter);
router.use(chaptersRouter);
router.use(highlightsRouter);
router.use(crawlRouter);

export default router;
