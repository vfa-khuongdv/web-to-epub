import express from "express";
import path from "path";
import apiRouter from "./routes";
import { closeBrowser } from "./services/renderer";
import { ttsRuntime } from "./services/tts/runtime";

const app = express();
const PORT = process.env.PORT || 3100;

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api", apiRouter);

const server = app.listen(PORT, () => {
  console.log(`Web-to-EPUB running at http://localhost:${PORT}`);
});

async function shutdown() {
  ttsRuntime.shutdown();
  await closeBrowser();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
