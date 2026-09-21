import { Response as ExpressResponse, Router } from "express";
import { CODE_RE, vault } from "../services/vault";
import { t } from "../services/lang";

export const vaultRouter = Router();

// ---- The lock on the private library (see services/vault.ts) ----------------

vaultRouter.get("/vault/status", (_req, res) => {
  res.json({ configured: vault.isConfigured() });
});

function answerUnlock(res: ExpressResponse, result: ReturnType<typeof vault.unlock>): void {
  if (result.ok) {
    res.json({ token: result.token });
    return;
  }
  if (result.reason === "locked-out") {
    res.status(429).json({
      message: t("Too many wrong codes — wait {seconds}s and try again", {
        seconds: Math.ceil(result.retryAfterMs / 1000),
      }),
      retryAfterMs: result.retryAfterMs,
    });
    return;
  }
  if (result.reason === "already-configured") {
    res.status(409).json({ message: t("A code has already been set for private mode") });
    return;
  }
  if (result.reason === "not-configured") {
    res.status(404).json({ message: t("No code has been set for private mode yet") });
    return;
  }
  if (result.reason === "bad-code") {
    res.status(400).json({ message: t("The code must be exactly 6 digits") });
    return;
  }
  // Wrong code: same wording and status whether or not a code exists, so the response
  // does not become an oracle for "is there a private library on this machine".
  res.status(401).json({ message: t("Wrong code") });
}

vaultRouter.post("/vault/setup", (req, res) => {
  const { code } = req.body as { code?: unknown };
  if (typeof code !== "string" || !CODE_RE.test(code)) {
    res.status(400).json({ message: t("The code must be exactly 6 digits") });
    return;
  }
  answerUnlock(res, vault.setup(code));
});

vaultRouter.post("/vault/unlock", (req, res) => {
  const { code } = req.body as { code?: unknown };
  answerUnlock(res, vault.unlock(typeof code === "string" ? code : ""));
});

vaultRouter.post("/vault/lock", (req, res) => {
  vault.lock(req.header("X-Vault-Token"));
  res.json({ ok: true });
});
