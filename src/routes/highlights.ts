import { Router } from "express";
import { HIGHLIGHT_COLORS, HighlightColor } from "../services/storyStore";
import { t } from "../services/lang";
import { libraryFor } from "./library";

export const highlightsRouter = Router();

// Highlights live server-side rather than in the browser: they are the reader's own
// notes on the text, and losing them to a cleared browser cache — or not seeing them
// in the Electron build after making them in the browser — would be worse than the
// extra routes.
highlightsRouter.get("/stories/:id/highlights", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  res.json({ highlights: await library.stories.listHighlights(req.params.id) });
});

highlightsRouter.post("/stories/:id/highlights", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const { chapterOrder, start, end, color, text } = req.body ?? {};
  if (!Number.isInteger(chapterOrder) || chapterOrder < 1) {
    res.status(400).json({ message: t("Invalid chapter order") });
    return;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    res.status(400).json({ message: t("Invalid highlight range") });
    return;
  }
  if (!HIGHLIGHT_COLORS.includes(color)) {
    res.status(400).json({ message: t("Invalid highlight colour") });
    return;
  }
  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ message: t("Highlighted text is required") });
    return;
  }
  if (!(await library.stories.getOutline(req.params.id))) {
    res.status(404).json({ message: t("Story not found") });
    return;
  }
  const highlight = await library.stories.addHighlight(req.params.id, {
    chapterOrder,
    start,
    end,
    color: color as HighlightColor,
    text,
  });
  res.status(201).json({ highlight });
});

highlightsRouter.patch("/stories/:id/highlights/:highlightId", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const color = req.body?.color;
  if (!HIGHLIGHT_COLORS.includes(color)) {
    res.status(400).json({ message: t("Invalid highlight colour") });
    return;
  }
  const updated = await library.stories.setHighlightColor(req.params.id, req.params.highlightId, color);
  if (!updated) {
    res.status(404).json({ message: t("Highlight not found") });
    return;
  }
  res.json({ ok: true });
});

highlightsRouter.delete("/stories/:id/highlights/:highlightId", async (req, res) => {
  const library = libraryFor(req, res);
  if (!library) return;
  const removed = await library.stories.removeHighlight(req.params.id, req.params.highlightId);
  if (!removed) {
    res.status(404).json({ message: t("Highlight not found") });
    return;
  }
  res.json({ ok: true });
});
