// Stand-in for tts/mix_story.py in tests: same stdin/stdout protocol, no numpy. The
// "MP3" it writes is the chapter files joined with "+", then "~music@<volume>" when the
// job has music, so a test can read back what was mixed.
const fs = require("fs");

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const job = JSON.parse(input);
  if (job.chapters.some((file) => !fs.existsSync(file))) {
    send({ type: "error", message: "missing chapter file" });
    process.exit(1);
  }
  const parts = job.chapters.map((file, i) => {
    send({ type: "progress", done: i + 1, total: job.chapters.length });
    return fs.readFileSync(file, "utf8");
  });
  const music = job.music ? `~music@${job.musicVolume}` : "";
  fs.writeFileSync(job.out, parts.join("+") + music);
  send({ type: "done", seconds: 3 * parts.length });
});
