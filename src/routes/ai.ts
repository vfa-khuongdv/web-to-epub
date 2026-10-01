import { Router } from "express";
import { loadAiConfig, saveAiConfig } from "../services/ai/aiConfig";
import { findProvider, PROVIDERS } from "../services/ai/providers";
import { t } from "../services/lang";

export const aiRouter = Router();

// A saved key is never sent back: the page only learns whether one is set.
aiRouter.get("/ai/config", (_req, res) => {
  const config = loadAiConfig();
  res.json({
    enabled: config.enabled,
    active: config.active,
    providers: PROVIDERS.map((info) => {
      const saved = config.providers[info.id];
      return {
        ...info,
        hasKey: Boolean(saved?.apiKey),
        baseUrl: saved?.baseUrl || info.baseUrl,
        model: saved?.model || info.defaultModel,
      };
    }),
  });
});

// Body: { enabled?, active?, providers?: { [id]: { apiKey?, baseUrl?, model? } } }.
// Only what is present changes; an empty apiKey keeps the saved one, so the page can
// resubmit the form without retyping a key it was never shown.
aiRouter.put("/ai/config", (req, res) => {
  const body = (req.body ?? {}) as {
    enabled?: unknown;
    active?: unknown;
    providers?: Record<string, { apiKey?: unknown; baseUrl?: unknown; model?: unknown }>;
  };
  const config = loadAiConfig();

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ message: t("enabled must be true or false") });
      return;
    }
    config.enabled = body.enabled;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "string" || !findProvider(body.active)) {
      res.status(400).json({ message: t("Unknown AI provider") });
      return;
    }
    config.active = body.active;
  }
  for (const [id, patch] of Object.entries(body.providers ?? {})) {
    if (!findProvider(id)) {
      res.status(400).json({ message: t("Unknown AI provider") });
      return;
    }
    const current = config.providers[id] ?? { apiKey: "" };
    const text = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
    const baseUrl = text(patch.baseUrl);
    if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
      res.status(400).json({ message: t("Base URL must start with http:// or https://") });
      return;
    }
    config.providers[id] = {
      apiKey: text(patch.apiKey) || current.apiKey,
      baseUrl: baseUrl === undefined ? current.baseUrl : baseUrl || undefined,
      model: text(patch.model) === undefined ? current.model : text(patch.model) || undefined,
    };
  }
  saveAiConfig(config);
  res.json({ ok: true });
});
