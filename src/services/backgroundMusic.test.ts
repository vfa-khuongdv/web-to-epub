import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_MUSIC_DIR } from "../config/paths";
import {
  MAX_MUSIC_BYTES,
  createBackgroundMusic,
  defaultMusicId,
  musicFormat,
  musicMime,
  seedBundledMusic,
} from "./backgroundMusic";

const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]);
const M4A = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A "), Buffer.alloc(64)]);

describe("musicFormat", () => {
  it("recognises what the browser plays, m4a included", () => {
    expect(musicFormat(MP3)?.ext).toBe("mp3");
    expect(musicFormat(M4A)?.ext).toBe("m4a");
    expect(musicFormat(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(64)]))?.ext).toBe("ogg");
    expect(musicMime("x.m4a")).toBe("audio/mp4");
  });

  it("rejects anything else and tiny files", () => {
    expect(musicFormat(Buffer.from("<html>not audio</html>"))).toBeUndefined();
    expect(musicFormat(Buffer.from("ID3"))).toBeUndefined();
  });
});

describe("background music", () => {
  let dir: string;
  let music: ReturnType<typeof createBackgroundMusic>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "music-"));
    music = createBackgroundMusic(path.join(dir, "music"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("lists nothing before the folder exists", async () => {
    expect(await music.list()).toEqual([]);
  });

  it("stores a track, lists it and serves its file", async () => {
    const track = await music.add("  Rain  ", M4A);
    expect(track.name).toBe("Rain");
    expect(track.file).toBe(`${track.id}.m4a`);
    expect((await music.list()).map((t) => t.id)).toEqual([track.id]);
    expect(await fs.readFile(music.filePath(track))).toEqual(M4A);
  });

  it("refuses a missing name, a non-audio file and an oversized one", async () => {
    await expect(music.add(" ", MP3)).rejects.toThrow("Give the track a name");
    await expect(music.add("x", Buffer.from("<html>not audio</html>"))).rejects.toThrow("Unsupported audio file");
    await expect(music.add("x", Buffer.concat([MP3, Buffer.alloc(MAX_MUSIC_BYTES)]))).rejects.toThrow("too large");
    expect(await music.list()).toEqual([]);
  });

  it("removes a track with its file, and ignores ids that are not its own", async () => {
    const track = await music.add("Rain", MP3);
    expect(await music.remove("../stories")).toBe(false);
    expect(await music.remove(track.id)).toBe(true);
    expect(await music.list()).toEqual([]);
    expect(await fs.readdir(path.join(dir, "music"))).toEqual([]);
  });
});

describe("seedBundledMusic", () => {
  let dir: string;
  let bundled: string;
  let music: ReturnType<typeof createBackgroundMusic>;
  let target: string;

  const manifest = (entries: { slug: string; name: string; file: string }[]) =>
    fs.writeFile(path.join(bundled, "tracks.json"), JSON.stringify(entries));

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "music-seed-"));
    bundled = path.join(dir, "bundle");
    target = path.join(dir, "library", "music");
    await fs.mkdir(bundled, { recursive: true });
    music = createBackgroundMusic(target);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("copies the bundle in as ordinary tracks, and the marker is not listed as one", async () => {
    await manifest([{ slug: "rain", name: "mưa", file: "rain.mp3" }]);
    await fs.writeFile(path.join(bundled, "rain.mp3"), MP3);
    await seedBundledMusic(music, bundled, target);

    const [track] = await music.list();
    expect(track.name).toBe("mưa");
    // An ordinary track: a generated id, and its bytes readable through filePath.
    expect(track.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await fs.readFile(music.filePath(track))).toEqual(MP3);
    expect((await fs.readdir(target)).filter((name) => !name.startsWith(track.id))).toEqual([".bundled"]);
  });

  it("copies each track once, and never brings back one the user removed", async () => {
    await manifest([
      { slug: "rain", name: "mưa", file: "rain.mp3" },
      { slug: "sun", name: "nắng", file: "sun.mp3" },
    ]);
    await fs.writeFile(path.join(bundled, "rain.mp3"), MP3);
    await fs.writeFile(path.join(bundled, "sun.mp3"), M4A);
    await seedBundledMusic(music, bundled, target);
    await seedBundledMusic(music, bundled, target);
    expect(await music.list()).toHaveLength(2);

    const [removed] = await music.list();
    await music.remove(removed.id);
    await seedBundledMusic(music, bundled, target);
    expect((await music.list()).map((t) => t.id)).not.toContain(removed.id);
    expect(await music.list()).toHaveLength(1);
  });

  // A marker that only remembers "already copied" would pin an install to a broken file
  // for good — there is no way for a fixed track to arrive.
  it("replaces a track the bundle has since changed, and leaves the user's alone", async () => {
    await manifest([{ slug: "rain", name: "mưa", file: "rain.mp3" }]);
    await fs.writeFile(path.join(bundled, "rain.mp3"), MP3);
    await seedBundledMusic(music, bundled, target);
    const first = (await music.list())[0];
    expect(await fs.readFile(music.filePath(first))).toEqual(MP3);

    const own = await music.add("của tôi", M4A);
    // A re-encode of the same track: same slug and name, different bytes.
    const reencoded = Buffer.concat([MP3, Buffer.from("re-encoded")]);
    await fs.writeFile(path.join(bundled, "rain.mp3"), reencoded);
    await seedBundledMusic(music, bundled, target);

    const list = await music.list();
    expect(list).toHaveLength(2);
    const replaced = list.find((track) => track.id !== own.id)!;
    expect(replaced.id).not.toBe(first.id);
    expect(await fs.readFile(music.filePath(replaced))).toEqual(reencoded);
    // The replaced copy is gone, not left behind next to the new one.
    expect(await fs.readdir(target).then((names) => names.filter((n) => n === `${first.id}.mp3`))).toEqual([]);
    expect(await fs.readFile(music.filePath(own))).toEqual(M4A);
  });

  it("picks up a marker left by the version that only stored an id", async () => {
    await manifest([{ slug: "rain", name: "mưa", file: "rain.mp3" }]);
    await fs.writeFile(path.join(bundled, "rain.mp3"), MP3);
    const track = await music.add("mưa", MP3);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, ".bundled"), JSON.stringify({ rain: track.id }));

    await seedBundledMusic(music, bundled, target);
    const list = await music.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).not.toBe(track.id);
    expect(await fs.readFile(music.filePath(list[0]))).toEqual(MP3);
  });

  it("keeps the user's own tracks, and adds a track a later version brings", async () => {
    const own = await music.add("của tôi", MP3);
    await manifest([{ slug: "rain", name: "mưa", file: "rain.mp3" }]);
    await fs.writeFile(path.join(bundled, "rain.mp3"), MP3);
    await seedBundledMusic(music, bundled, target);

    expect((await music.list()).map((t) => t.id)).toContain(own.id);
    expect(await music.list()).toHaveLength(2);

    await manifest([
      { slug: "rain", name: "mưa", file: "rain.mp3" },
      { slug: "sun", name: "nắng", file: "sun.mp3" },
    ]);
    await fs.writeFile(path.join(bundled, "sun.mp3"), M4A);
    await seedBundledMusic(music, bundled, target);
    expect(await music.list()).toHaveLength(3);
  });

  // The bundle is authoritative: replacing the shipped music has to take the old set with
  // it, or every install keeps the six tracks a later version dropped.
  it("removes a track the bundle stopped shipping, and nothing else", async () => {
    const own = await music.add("của tôi", M4A);
    await manifest([
      { slug: "rain", name: "mưa", file: "rain.mp3" },
      { slug: "sun", name: "nắng", file: "sun.mp3" },
    ]);
    await fs.writeFile(path.join(bundled, "rain.mp3"), MP3);
    await fs.writeFile(path.join(bundled, "sun.mp3"), M4A);
    await seedBundledMusic(music, bundled, target);
    const dropped = (await music.list()).find((t) => t.name === "mưa")!;
    expect(await music.list()).toHaveLength(3);

    await manifest([{ slug: "sun", name: "nắng", file: "sun.mp3" }]);
    await seedBundledMusic(music, bundled, target);

    const list = await music.list();
    expect(list.map((t) => t.id)).not.toContain(dropped.id);
    expect(list.map((t) => t.name).sort()).toEqual(["của tôi", "nắng"]);
    // Its file went with it, and no marker entry is left claiming it.
    expect(await fs.readdir(target).then((names) => names.filter((n) => n.startsWith(dropped.id)))).toEqual([]);
    const marker = JSON.parse(await fs.readFile(path.join(target, ".bundled"), "utf8"));
    expect(Object.keys(marker)).toEqual(["sun"]);
  });

  it("leaves the bundled tracks alone when the manifest cannot be read", async () => {
    await manifest([{ slug: "rain", name: "mưa", file: "rain.mp3" }]);
    await fs.writeFile(path.join(bundled, "rain.mp3"), MP3);
    await seedBundledMusic(music, bundled, target);
    expect(await music.list()).toHaveLength(1);

    await fs.writeFile(path.join(bundled, "tracks.json"), "{ this is not json");
    await seedBundledMusic(music, bundled, target);
    expect(await music.list()).toHaveLength(1);
  });

  it("does nothing when the app ships no music, and lets a broken bundle throw", async () => {
    await seedBundledMusic(music, bundled, target);
    expect(await music.list()).toEqual([]);

    await manifest([{ slug: "rain", name: "mưa", file: "gone.mp3" }]);
    await expect(seedBundledMusic(music, bundled, target)).rejects.toThrow();
  });
});

describe("defaultMusicId", () => {
  let dir: string;
  let bundled: string;
  let target: string;
  let music: ReturnType<typeof createBackgroundMusic>;

  const manifest = (entries: { slug: string; name: string; file: string; default?: boolean }[]) =>
    fs.writeFile(path.join(bundled, "tracks.json"), JSON.stringify(entries));

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "music-default-"));
    bundled = path.join(dir, "bundle");
    target = path.join(dir, "library", "music");
    await fs.mkdir(bundled, { recursive: true });
    music = createBackgroundMusic(target);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("is the id the marked track was seeded as, not its slug", async () => {
    await manifest([
      { slug: "rain", name: "mưa", file: "rain.mp3" },
      { slug: "sun", name: "nắng", file: "sun.mp3", default: true },
    ]);
    await fs.writeFile(path.join(bundled, "rain.mp3"), MP3);
    await fs.writeFile(path.join(bundled, "sun.mp3"), M4A);
    await seedBundledMusic(music, bundled, target);

    const sun = (await music.list()).find((track) => track.name === "nắng")!;
    expect(await defaultMusicId(music, target, bundled)).toBe(sun.id);
    // Not the first entry: the manifest marks which one, so order cannot change it.
    expect(await defaultMusicId(music, target, bundled)).not.toBe((await music.list())[0].id);
  });

  it("is null when nothing is marked, and when the user removed the marked track", async () => {
    await manifest([{ slug: "rain", name: "mưa", file: "rain.mp3" }]);
    await fs.writeFile(path.join(bundled, "rain.mp3"), MP3);
    await seedBundledMusic(music, bundled, target);
    expect(await defaultMusicId(music, target, bundled)).toBeNull();

    await manifest([{ slug: "rain", name: "mưa", file: "rain.mp3", default: true }]);
    await seedBundledMusic(music, bundled, target);
    const [seeded] = await music.list();
    expect(await defaultMusicId(music, target, bundled)).toBe(seeded.id);

    await music.remove(seeded.id);
    expect(await defaultMusicId(music, target, bundled)).toBeNull();
  });
});

// The bundle is data the app depends on, and a mistyped key in it drops tracks silently:
// seeding keys the marker by slug, so entries with no slug all collide on "undefined" and
// only the first is ever copied.
describe("the music the app ships", () => {
  it("lists tracks the player accepts, with the files they name", async () => {
    const manifest = JSON.parse(
      await fs.readFile(path.join(BUNDLED_MUSIC_DIR, "tracks.json"), "utf8")
    ) as { slug: string; name: string; file: string }[];

    expect(manifest.length).toBeGreaterThan(0);
    for (const track of manifest) {
      expect(track.slug, "a manifest entry needs a slug").toBeTruthy();
      expect(track.name).toBeTruthy();
      const file = path.join(BUNDLED_MUSIC_DIR, track.file);
      const bytes = await fs.readFile(file);
      expect(musicFormat(bytes), `${track.file} is not audio the player can use`).toBeDefined();
      expect(bytes.length, `${track.file} is over the upload limit`).toBeLessThanOrEqual(MAX_MUSIC_BYTES);
    }
    expect(new Set(manifest.map((track) => track.slug)).size, "slugs must be unique").toBe(manifest.length);
  });
});
