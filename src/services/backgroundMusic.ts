import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { BUNDLED_MUSIC_DIR, DATA_DIR } from "../config/paths";
import { t } from "./lang";

/**
 * Music the user uploads to play quietly under the narration: in the in-app player, and
 * mixed into audio exports when the user asks for it (tts/musicMix.ts). Shared by both
 * libraries, like custom voices:
 *
 *   <dir>/<id>.<ext>    the file as uploaded
 *   <dir>/<id>.json     { id, name, file, createdAt }
 */
export const MUSIC_DIR = path.join(DATA_DIR, "music");
export const MAX_MUSIC_BYTES = 50 * 1024 * 1024;
export const MAX_MUSIC_NAME = 80;

export interface MusicTrack {
  id: string;
  name: string;
  file: string;
  createdAt: string;
}

// What the browser's <audio> plays, told apart by their first bytes.
const FORMATS: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: "wav", mime: "audio/wav", test: (b) => b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WAVE" },
  { ext: "flac", mime: "audio/flac", test: (b) => b.toString("latin1", 0, 4) === "fLaC" },
  { ext: "ogg", mime: "audio/ogg", test: (b) => b.toString("latin1", 0, 4) === "OggS" },
  { ext: "m4a", mime: "audio/mp4", test: (b) => b.toString("latin1", 4, 8) === "ftyp" },
  // ID3 tag, or a bare MPEG audio frame sync.
  { ext: "mp3", mime: "audio/mpeg", test: (b) => b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
];

export function musicFormat(bytes: Buffer): { ext: string; mime: string } | undefined {
  if (bytes.length < 12) return undefined;
  return FORMATS.find((format) => format.test(bytes));
}

export function musicMime(file: string): string {
  const ext = path.extname(file).slice(1);
  return FORMATS.find((format) => format.ext === ext)?.mime ?? "application/octet-stream";
}

const ID_RE = /^[0-9a-f-]{36}$/;

// One entry of tts/music/tracks.json: the music that ships with the app.
export interface BundledTrack {
  // Stable across versions — the key in the seed marker, not a track id.
  slug: string;
  name: string;
  file: string;
  // The track the app plays by default. Exactly one entry should carry it; marked in the
  // manifest rather than taken from the order, so inserting a track above it cannot
  // silently change what the app plays out of the box.
  default?: boolean;
}

const SEED_FILE = ".bundled";

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function createBackgroundMusic(dir: string) {
  const metaPath = (id: string) => path.join(dir, `${id}.json`);

  async function get(id: string): Promise<MusicTrack | undefined> {
    if (!ID_RE.test(id)) return undefined;
    try {
      return JSON.parse(await fs.readFile(metaPath(id), "utf8")) as MusicTrack;
    } catch {
      return undefined;
    }
  }

  return {
    get,

    async list(): Promise<MusicTrack[]> {
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        return [];
      }
      const tracks = await Promise.all(
        names.filter((name) => name.endsWith(".json")).map((name) => get(name.slice(0, -".json".length)))
      );
      return tracks.filter((track): track is MusicTrack => track !== undefined).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    // Throws a user-facing message for a file that is not audio the player can use.
    async add(name: string, bytes: Buffer): Promise<MusicTrack> {
      const trimmed = name.trim().slice(0, MAX_MUSIC_NAME);
      if (!trimmed) throw new Error(t("Give the track a name"));
      if (bytes.length > MAX_MUSIC_BYTES) throw new Error(t("The music file is too large (50 MB at most)"));
      const format = musicFormat(bytes);
      if (!format) throw new Error(t("Unsupported audio file — use MP3, M4A, WAV, FLAC or OGG"));
      await fs.mkdir(dir, { recursive: true });
      const id = randomUUID();
      const track: MusicTrack = { id, name: trimmed, file: `${id}.${format.ext}`, createdAt: new Date().toISOString() };
      await fs.writeFile(path.join(dir, track.file), bytes);
      // Meta last: a file without one is not listed.
      await fs.writeFile(metaPath(id), JSON.stringify(track));
      return track;
    },

    filePath(track: MusicTrack): string {
      return path.join(dir, track.file);
    },

    async remove(id: string): Promise<boolean> {
      const track = await get(id);
      if (!track) return false;
      await fs.rm(metaPath(id), { force: true });
      await fs.rm(path.join(dir, track.file), { force: true });
      return true;
    },
  };
}

export type BackgroundMusic = ReturnType<typeof createBackgroundMusic>;

// What the marker remembers about one slug it has already copied.
interface Seeded {
  id: string;
  // The size of the bundled file at the time. A different one means the app now ships
  // another version of that track, and it is copied over the old one — without this, a
  // fixed or re-encoded track could never reach an install that already had the broken
  // one, and the marker that stops deleted tracks from coming back is also what would
  // keep the bad copy forever.
  bytes: number;
}

/**
 * Copies the music that ships with the app into the library. A bundled track is stored as
 * an ordinary one — its own id, listed, playable and removable like an uploaded track — so
 * nothing else in the app has to know the bundle exists.
 *
 * The marker remembers which slugs have been copied and at what size, so a slug in it is
 * left alone (a track the user deleted stays deleted), while a slug this version adds, or
 * one whose file this version changed, is copied. A bundle that is missing or unreadable is
 * not an error: the user can still add their own music, so the caller decides what to do
 * about a throw.
 */
export async function seedBundledMusic(
  music: Pick<BackgroundMusic, "add" | "remove">,
  bundledDir: string = BUNDLED_MUSIC_DIR,
  targetDir: string = MUSIC_DIR
): Promise<void> {
  const manifest = await readJson<BundledTrack[]>(path.join(bundledDir, "tracks.json"));
  if (!manifest?.length) return;
  // A marker written before the size was recorded holds a bare id, and is read as one
  // here: it has no size to compare, so its track is replaced rather than left in place.
  const seeded: Record<string, Seeded | string> =
    (await readJson<Record<string, Seeded | string>>(path.join(targetDir, SEED_FILE))) ?? {};
  const done: Record<string, Seeded> = {};
  await fs.mkdir(targetDir, { recursive: true });
  for (const track of manifest) {
    const file = path.join(bundledDir, track.file);
    // Stat, not read: a boot that changes nothing should not pull 20 MB through memory.
    const { size } = await fs.stat(file);
    const was = seeded[track.slug];
    const wasId = typeof was === "string" ? was : was?.id;
    const wasBytes = typeof was === "string" ? undefined : was?.bytes;
    if (wasId && wasBytes === size) {
      done[track.slug] = { id: wasId, bytes: size };
      continue;
    }
    if (wasId) await music.remove(wasId);
    done[track.slug] = { id: (await music.add(track.name, await fs.readFile(file))).id, bytes: size };
  }
  // The bundle is authoritative for the tracks it owns: a slug it used to ship and no
  // longer does is removed too, or replacing the shipped music would leave the old set in
  // every install forever. Only marked slugs are touched, so the user's own music is safe.
  // Not reached when the manifest is missing or empty: an unreadable bundle must not be
  // read as "ship nothing" and wipe what is already there.
  const shipped = new Set(manifest.map((track) => track.slug));
  for (const [slug, was] of Object.entries(seeded)) {
    if (shipped.has(slug)) continue;
    await music.remove(typeof was === "string" ? was : was.id);
  }
  await fs.writeFile(path.join(targetDir, SEED_FILE), JSON.stringify(done));
}

/**
 * The track the app plays by default, as the id it has in this library — the manifest
 * names a slug, but only the marker knows which id that slug was seeded as. Null when no
 * entry is marked, when the bundle is unreadable, or when the user removed that track:
 * the player falls back to silence rather than to a made-up id.
 */
export async function defaultMusicId(
  music: Pick<BackgroundMusic, "get">,
  targetDir: string = MUSIC_DIR,
  bundledDir: string = BUNDLED_MUSIC_DIR
): Promise<string | null> {
  const manifest = await readJson<BundledTrack[]>(path.join(bundledDir, "tracks.json"));
  const slug = manifest?.find((track) => track.default)?.slug;
  if (!slug) return null;
  const seeded = await readJson<Record<string, Seeded | string>>(path.join(targetDir, SEED_FILE));
  const was = seeded?.[slug];
  const id = typeof was === "string" ? was : was?.id;
  return id && (await music.get(id)) ? id : null;
}

export const backgroundMusic = createBackgroundMusic(MUSIC_DIR);
