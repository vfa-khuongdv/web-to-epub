import path from "path";

// Directory containing the library (stories.db + covers/). Default is ./data next to
// where the command runs; the macOS app bundle has cwd of "/" so DATA_DIR must point
// to the app's data directory (see electron/main.js).
export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");

// The private library: its own stories.db + covers/, so a query against the normal
// library cannot return a hidden story even if it forgets to filter. Created on the
// first time the user sets a code, not at startup.
export const PRIVATE_DIR = path.join(DATA_DIR, "private");

// Music that ships with the app (tts/music/tracks.json and the MP3s it names). It lives
// under tts/ because that is the one directory package.json and the Dockerfile already
// copy, and asarUnpack it — media cannot be read from inside an asar. The asar path is
// rewritten for the same reason as BUNDLED_VOICES_DIR.
export const BUNDLED_MUSIC_DIR = path
  .join(__dirname, "..", "..", "tts", "music")
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
