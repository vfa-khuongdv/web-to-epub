// Renders the "Preview" samples that ship with the app into tts/voices/ (see
// src/services/tts/voiceCatalog.ts), with the engines installed under DATA_DIR. Needs
// `npm run build` first (reads dist/). Samples already there are kept unless --force.
//
//   DATA_DIR="$HOME/Library/Application Support/web-to-epub/data" node scripts/voice-samples.js [--force]
//
// Lists VieNeu's presets per model into presets.json, then reads PREVIEW_TEXT with each of
// them, the model's default voice and every OmniVoice built-in clip in omnivoice.json.
// An engine that is not installed is skipped (its entries in presets.json are kept).
const fs = require("fs/promises");
const path = require("path");
const dist = (...parts) => require(path.join(__dirname, "..", "dist", ...parts));
const { BUNDLED_VOICES_DIR } = dist("config", "tts");
const { customVoices } = dist("services", "tts", "customVoices");
const { runtimeFor, ttsEngines } = dist("services", "tts", "runtime");
const { BUILTIN_VOICE_PREFIX, PREVIEW_TEXT, sampleName, voiceCatalog } = dist("services", "tts", "voiceCatalog");

const force = process.argv.includes("--force");
const log = (...args) => console.log("[voices]", ...args);

async function render(variant, voiceId) {
  const out = path.join(BUNDLED_VOICES_DIR, "samples", variant, `${sampleName(voiceId)}.mp3`);
  const exists = await fs.stat(out).then(
    () => true,
    () => false
  );
  if (exists && !force) return;
  await fs.mkdir(path.dirname(out), { recursive: true });
  const voice = await customVoices.synthVoice(voiceId, variant);
  const started = Date.now();
  await ttsEngines.withModel(variant, (worker) => worker.synth({ parts: [PREVIEW_TEXT], ...voice, out }));
  log(`${variant} ${voiceId || "(default)"} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

async function installed(variant) {
  if ((await runtimeFor(variant).status()).state === "installed") return true;
  log(`${variant}: engine not installed under DATA_DIR, skipped`);
  return false;
}

async function main() {
  const presetsFile = path.join(BUNDLED_VOICES_DIR, "presets.json");
  const presets = JSON.parse(await fs.readFile(presetsFile, "utf8").catch(() => "{}"));
  for (const variant of ["turbo", "nano"]) {
    if (!(await installed(variant))) continue;
    presets[variant] = await ttsEngines.withModel(variant, async (_worker, model) => model.voices);
    await fs.mkdir(BUNDLED_VOICES_DIR, { recursive: true });
    await fs.writeFile(presetsFile, `${JSON.stringify(presets, null, 2)}\n`);
    log(`${variant}: ${presets[variant].length} presets`);
    for (const voiceId of ["", ...presets[variant].map((voice) => voice.id)]) await render(variant, voiceId);
  }
  if (await installed("omnivoice")) {
    for (const voice of await voiceCatalog.builtins()) await render("omnivoice", `${BUILTIN_VOICE_PREFIX}${voice.id}`);
  }
}

main()
  .then(() => {
    ttsEngines.shutdown();
    process.exit(0);
  })
  .catch((err) => {
    console.error("[voices] failed:", err.message);
    ttsEngines.shutdown();
    process.exit(1);
  });
