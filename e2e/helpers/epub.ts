import fs from "fs";
import { unzipSync } from "fflate";

export interface EpubContents {
  files: Record<string, Uint8Array>;
  text(path: string): string;
  opf: string;
  allXhtml: string;
}

export function readEpub(file: string): EpubContents {
  const files = unzipSync(new Uint8Array(fs.readFileSync(file)));
  const text = (path: string) => new TextDecoder().decode(files[path]);
  return {
    files,
    text,
    opf: text("OEBPS/content.opf"),
    allXhtml: Object.keys(files)
      .filter((path) => path.endsWith(".xhtml"))
      .map(text)
      .join("\n"),
  };
}
