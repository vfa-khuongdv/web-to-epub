// Stand-in for tts/vieneu_worker.py in tests: same JSON-lines protocol, no model.
// A part "FAIL" answers an error, "CRASH" kills the process, "SLOW" takes longer.
const fs = require("fs");
const readline = require("readline");

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const cancelled = new Set();
const queue = [];
let busy = false;
let variant = null;

async function handle(message) {
  if (message.cmd === "quit") process.exit(0);
  if (message.cmd === "load") {
    variant = message.variant;
    process.stderr.write(`loading ${variant}\n`);
    send({ type: "loaded", variant, voices: [{ id: "A", label: "A — test" }], sampleRate: 24000 });
    return;
  }
  if (message.cmd === "synth") {
    if (!variant) return send({ type: "error", id: message.id, message: "model not loaded" });
    for (let i = 0; i < message.parts.length; i++) {
      if (cancelled.has(message.id)) return send({ type: "cancelled", id: message.id });
      const part = message.parts[i];
      if (part === "CRASH") {
        process.stderr.write("boom\n");
        process.exit(3);
      }
      if (part === "FAIL") return send({ type: "error", id: message.id, message: "bad part" });
      await new Promise((r) => setTimeout(r, part === "SLOW" ? 80 : 5));
      send({ type: "progress", id: message.id, part: i + 1, parts: message.parts.length });
    }
    fs.writeFileSync(message.out, `${variant}:${message.voice}:${message.parts.join("|")}`);
    // One second per part, no pauses: part i spans [i, i + 1].
    send({ type: "done", id: message.id, seconds: message.parts.length, timings: message.parts.map((_, i) => [i, i + 1]) });
    return;
  }
  send({ type: "error", id: message.id ?? null, message: `unknown command: ${message.cmd}` });
}

async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) await handle(queue.shift());
  busy = false;
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.cmd === "cancel") cancelled.add(message.id);
  else {
    queue.push(message);
    drain();
  }
});
send({ type: "ready" });
