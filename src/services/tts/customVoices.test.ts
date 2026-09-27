import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_VOICE_BYTES, audioExtension, createCustomVoices } from "./customVoices";

const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(64)]);

describe("audioExtension", () => {
  it("recognises the formats the worker can read", () => {
    expect(audioExtension(MP3)).toBe("mp3");
    expect(audioExtension(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(64)]))).toBe("mp3");
    expect(audioExtension(WAV)).toBe("wav");
    expect(audioExtension(Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(64)]))).toBe("flac");
    expect(audioExtension(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(64)]))).toBe("ogg");
  });

  it("rejects anything else, including m4a and tiny files", () => {
    expect(audioExtension(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A "), Buffer.alloc(64)]))).toBeUndefined();
    expect(audioExtension(Buffer.from("<html>not audio</html>"))).toBeUndefined();
    expect(audioExtension(Buffer.from("ID3"))).toBeUndefined();
  });
});

describe("custom voices", () => {
  let dir: string;
  let voices: ReturnType<typeof createCustomVoices>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "custom-voices-"));
    voices = createCustomVoices(path.join(dir, "voices"), {
      builtin: async (id) => (id === "an" ? { refAudio: "/bundled/clips/an.mp3", refPrompt: "/cache/an.omnivoice.pt" } : undefined),
    });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("lists nothing before the folder exists", async () => {
    expect(await voices.list()).toEqual([]);
  });

  it("stores a clip, lists it and hands its path to the worker", async () => {
    const voice = await voices.add("  Giọng tôi  ", MP3);
    expect(voice.name).toBe("Giọng tôi");
    expect(voice.file).toBe(`${voice.id}.mp3`);
    expect(await voices.list()).toEqual([voice]);

    const request = await voices.synthVoice(`custom:${voice.id}`);
    expect(request).toEqual({ voice: `custom:${voice.id}`, refAudio: path.join(dir, "voices", voice.file) });
    expect(await fs.readFile(request.refAudio!)).toEqual(MP3);
  });

  it("passes preset voices through untouched", async () => {
    expect(await voices.synthVoice("Xuân Vĩnh")).toEqual({ voice: "Xuân Vĩnh" });
    expect(await voices.synthVoice("")).toEqual({ voice: "" });
  });

  it("keeps a typed transcript and hands it to the worker with the clip", async () => {
    const voice = await voices.add("A", WAV, "  Xin chào,\n  tôi là   Minh.  ");
    expect(voice.transcript).toBe("Xin chào, tôi là Minh.");
    expect(await voices.synthVoice(`custom:${voice.id}`, "omnivoice")).toEqual({
      voice: `custom:${voice.id}`,
      refAudio: path.join(dir, "voices", voice.file),
      refText: "Xin chào, tôi là Minh.",
    });
    // Blank means "let Whisper transcribe it": nothing is stored.
    expect((await voices.add("B", WAV, "   ")).transcript).toBeUndefined();
    await expect(voices.add("C", WAV, "a".repeat(1001))).rejects.toThrow("transcript is too long");
  });

  it("refuses a preset or the default voice for OmniVoice, which has none", async () => {
    await expect(voices.synthVoice("", "omnivoice")).rejects.toThrow("no default voice");
    await expect(voices.synthVoice("Xuân Vĩnh", "omnivoice")).rejects.toThrow("no default voice");
    expect(await voices.synthVoice("Xuân Vĩnh", "turbo")).toEqual({ voice: "Xuân Vĩnh" });
  });

  it("hands a built-in voice's clip to either engine, and fails clearly for an unknown one", async () => {
    const expected = { voice: "builtin:an", refAudio: "/bundled/clips/an.mp3", refPrompt: "/cache/an.omnivoice.pt" };
    expect(await voices.synthVoice("builtin:an", "omnivoice")).toEqual(expected);
    expect(await voices.synthVoice("builtin:an", "turbo")).toEqual(expected);
    await expect(voices.synthVoice("builtin:gone", "omnivoice")).rejects.toThrow("no longer available");
  });

  it("refuses a nameless, oversized or non-audio clip", async () => {
    await expect(voices.add("   ", MP3)).rejects.toThrow("Give the voice a name");
    await expect(voices.add("A", Buffer.concat([MP3, Buffer.alloc(MAX_VOICE_BYTES)]))).rejects.toThrow("too large");
    await expect(voices.add("A", Buffer.from("definitely not audio"))).rejects.toThrow("Unsupported audio file");
    expect(await voices.list()).toEqual([]);
  });

  it("removes the clip with its entry, and a removed voice fails clearly", async () => {
    const voice = await voices.add("A", WAV);
    // What the OmniVoice worker saves next to the clip goes with it.
    await fs.writeFile(path.join(dir, "voices", `${voice.file}.omnivoice.pt`), "prompt");
    expect(await voices.remove(voice.id)).toBe(true);
    expect(await voices.list()).toEqual([]);
    expect(await fs.readdir(path.join(dir, "voices"))).toEqual([]);
    expect(await voices.remove(voice.id)).toBe(false);
    await expect(voices.synthVoice(`custom:${voice.id}`)).rejects.toThrow("no longer exists");
  });

  it("does not read outside its folder for a crafted id", async () => {
    expect(await voices.remove("../../etc/passwd")).toBe(false);
    await expect(voices.synthVoice("custom:../secret")).rejects.toThrow("no longer exists");
  });
});
