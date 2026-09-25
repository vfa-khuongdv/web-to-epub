// Narration engine from the command line (make tts-install / tts-smoke / tts-uninstall):
// the same runtime the Settings page drives, for checking a machine or a Docker volume
// without opening the app. Needs `npm run build` first (reads dist/).
//
//   node scripts/tts.js install [turbo|nano]
//   node scripts/tts.js smoke   [turbo|nano]
//   node scripts/tts.js uninstall
const path = require("path");
const { TTS_DIR } = require(path.join(__dirname, "..", "dist", "config", "tts"));
const { ttsRuntime } = require(path.join(__dirname, "..", "dist", "services", "tts", "runtime"));

const [command, variantArg] = process.argv.slice(2);
const variant = variantArg || "turbo";
const log = (...args) => console.log("[tts]", ...args);

async function install() {
  const started = Date.now();
  let last = "";
  const timer = setInterval(async () => {
    const status = await ttsRuntime.status();
    const bytes = status.total ? ` ${Math.round((100 * (status.downloaded ?? 0)) / status.total)}%` : "";
    const line = `${status.phase ?? status.state}${bytes}`;
    if (line !== last) log(line);
    last = line;
  }, 2000);
  try {
    await ttsRuntime.install(variant);
  } finally {
    clearInterval(timer);
  }
  log(`installed (${variant}) in ${Math.round((Date.now() - started) / 1000)} s → ${TTS_DIR}`);
  log(`on disk: ${Math.round((await ttsRuntime.diskBytes()) / 1e6)} MB`);
}

async function smoke() {
  if ((await ttsRuntime.status()).state !== "installed") throw new Error("not installed — run: make tts-install");
  const out = path.join(require("os").tmpdir(), `tts-smoke-${process.pid}.mp3`);
  const started = Date.now();
  const { seconds } = await ttsRuntime.withModel(variant, (worker, model) => {
    log(`${model.variant}: ${model.voices.length} voices, ${model.sampleRate} Hz`);
    return worker.synth({ parts: ["Xin chào, đây là bài kiểm tra giọng đọc."], voice: "", out });
  });
  log(`${seconds} s of audio in ${((Date.now() - started) / 1000).toFixed(1)} s → ${out}`);
}

async function uninstall() {
  await ttsRuntime.uninstall();
  log(`removed ${TTS_DIR} (narrated chapters are kept)`);
}

const commands = { install, smoke, uninstall };
if (!commands[command]) {
  console.error("usage: node scripts/tts.js install|smoke|uninstall [turbo|nano]");
  process.exit(2);
}
commands[command]()
  .then(() => {
    ttsRuntime.shutdown();
    process.exit(0);
  })
  .catch((err) => {
    console.error("[tts] failed:", err.message);
    ttsRuntime.shutdown();
    process.exit(1);
  });
