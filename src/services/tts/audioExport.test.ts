import fs from "fs/promises";
import os from "os";
import path from "path";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chapterAudioFileName, writeAudioZip } from "./audioExport";

describe("chapterAudioFileName", () => {
  it("pads the order to at least three digits, or to the widest order", () => {
    expect(chapterAudioFileName(7, "Chương 7", 1)).toBe("007 - Chương 7.mp3");
    expect(chapterAudioFileName(42, "Chương 42", 4)).toBe("0042 - Chương 42.mp3");
  });

  it("keeps diacritics, replaces characters a filesystem refuses, and names untitled chapters", () => {
    expect(chapterAudioFileName(1, 'Hồi 1: "Gặp gỡ" / Phần a?', 1)).toBe("001 - Hồi 1 Gặp gỡ Phần a.mp3");
    expect(chapterAudioFileName(3, "   ", 1)).toBe("003 - Chapter 3.mp3");
  });
});

describe("writeAudioZip", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-zip-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("stores every file byte for byte, in order, under its name", async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 7); // several read chunks
    await fs.writeFile(path.join(dir, "1.mp3"), "first");
    await fs.writeFile(path.join(dir, "2.mp3"), big);
    const dest = path.join(dir, "out.zip");

    await writeAudioZip(
      [
        { name: "001 - Một.mp3", filePath: path.join(dir, "1.mp3") },
        { name: "002 - Hai.mp3", filePath: path.join(dir, "2.mp3") },
      ],
      dest
    );

    const entries = unzipSync(new Uint8Array(await fs.readFile(dest)));
    expect(Object.keys(entries)).toEqual(["001 - Một.mp3", "002 - Hai.mp3"]);
    expect(Buffer.from(entries["001 - Một.mp3"]).toString()).toBe("first");
    expect(Buffer.from(entries["002 - Hai.mp3"]).equals(big)).toBe(true);
  });

  it("de-duplicates repeated names", async () => {
    await fs.writeFile(path.join(dir, "a.mp3"), "a");
    const dest = path.join(dir, "dup.zip");
    await writeAudioZip(
      [
        { name: "x.mp3", filePath: path.join(dir, "a.mp3") },
        { name: "x.mp3", filePath: path.join(dir, "a.mp3") },
      ],
      dest
    );
    expect(Object.keys(unzipSync(new Uint8Array(await fs.readFile(dest))))).toEqual(["x.mp3", "x (2).mp3"]);
  });

  it("fails when a source file is missing", async () => {
    const dest = path.join(dir, "bad.zip");
    await expect(writeAudioZip([{ name: "x.mp3", filePath: path.join(dir, "nope.mp3") }], dest)).rejects.toThrow(/ENOENT/);
    await expect(fs.access(dest)).rejects.toThrow();
  });
});
