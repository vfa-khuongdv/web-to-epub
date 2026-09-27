import express from "express";
import path from "path";
import apiRouter from "./routes";
import { backgroundMusic, seedBundledMusic } from "./services/backgroundMusic";
import { closeBrowser } from "./services/renderer";
import { ttsEngines } from "./services/tts/runtime";

const app = express();
const PORT = process.env.PORT || 3100;

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api", apiRouter);

let server: ReturnType<typeof app.listen> | undefined;

async function start() {
  // Music that ships with the app is copied into the library before the app answers, so
  // the list is complete from the first request. A bundle that is missing or unreadable
  // only costs the bundled tracks — the user can still add their own.
  try {
    await seedBundledMusic(backgroundMusic);
  } catch (err) {
    console.warn(`Bundled music not available: ${err instanceof Error ? err.message : err}`);
  }
  server = app.listen(PORT, () => {
    console.log(`Web-to-EPUB running at http://localhost:${PORT}`);
  });
}

async function shutdown() {
  ttsEngines.shutdown();
  await closeBrowser();
  if (!server) process.exit(0);
  else server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

void start();
