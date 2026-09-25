import { createReadStream, createWriteStream } from "fs";
import { once } from "events";
import { rm } from "fs/promises";
import { Zip, ZipPassThrough } from "fflate";
import { fileStem } from "../epubBuilder";

export interface AudioZipEntry {
  name: string;
  filePath: string;
}

// "007 - Chương 7.mp3": the number keeps players and file browsers in reading order, and
// is padded to the widest order in the export (at least 3 digits) so 10 sorts after 9.
export function chapterAudioFileName(order: number, title: string, width: number): string {
  const number = String(order).padStart(Math.max(3, width), "0");
  return `${number} - ${fileStem(title, `Chapter ${order}`)}.mp3`;
}

// Names are unique within the zip even when two chapters share a title; the order
// prefix already makes them unique, this only guards a caller that passes duplicates.
function uniqueNames(entries: AudioZipEntry[]): AudioZipEntry[] {
  const seen = new Set<string>();
  return entries.map((entry) => {
    let name = entry.name;
    for (let i = 2; seen.has(name); i++) name = entry.name.replace(/\.mp3$/, ` (${i}).mp3`);
    seen.add(name);
    return { ...entry, name };
  });
}

/**
 * Write a zip of MP3s to `dest`, streaming: a whole story's narration runs to gigabytes,
 * so neither the files nor the archive are held in memory. Entries are stored, not
 * deflated — MP3 does not compress further and storing is far faster.
 */
export async function writeAudioZip(entries: AudioZipEntry[], dest: string): Promise<void> {
  const out = createWriteStream(dest);
  let failure: Error | undefined;
  const finished = new Promise<void>((resolve, reject) => {
    out.on("error", reject);
    out.on("finish", resolve);
  });

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      failure = err;
      out.destroy(err);
      return;
    }
    out.write(chunk);
    if (final) out.end();
  });

  try {
    for (const entry of uniqueNames(entries)) {
      const file = new ZipPassThrough(entry.name);
      zip.add(file);
      for await (const chunk of createReadStream(entry.filePath)) {
        file.push(chunk as Buffer);
        // Backpressure: reading the disk is faster than writing it; without this the
        // write stream would buffer the whole archive in RAM.
        if (out.writableNeedDrain) await once(out, "drain");
        if (failure) throw failure;
      }
      file.push(new Uint8Array(0), true);
    }
    zip.end();
  } catch (err) {
    // The stream's own error is this one; don't leave it as an unhandled rejection, nor
    // a half-written archive on disk.
    finished.catch(() => {});
    out.destroy(err as Error);
    await rm(dest, { force: true });
    throw err;
  }
  await finished;
}
