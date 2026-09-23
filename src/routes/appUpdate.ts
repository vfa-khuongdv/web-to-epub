import { Router } from "express";
import { APP_VERSION } from "../config/appInfo";
import { appUpdateChecker } from "../services/appUpdate";

export const appUpdateRouter = Router();

// Whether a newer release exists. Silent on failure — the check runs unasked, so it
// answers "no update" rather than an error (services/appUpdate.ts).
appUpdateRouter.get("/app-update", async (_req, res) => {
  res.json(await appUpdateChecker.check(APP_VERSION));
});
