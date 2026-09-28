import { zipSync } from "fflate";

// A real 1x1 PNG — sniffed by magic bytes, like any cover or book image.
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

export interface FixtureChapter {
  id: string;
  // Path inside the zip, always under OEBPS/ (the OPF sits at OEBPS/content.opf).
  file: string;
  // nav/NCX label. Omit to exercise the h1 / file-name fallbacks.
  title?: string;
  // Content of <body>.
  html: string;
}

export interface EpubFixtureOptions {
  version?: 2 | 3;
  title?: string;
  author?: string;
  language?: string;
  chapters?: FixtureChapter[];
  cover?: { file: string; bytes: Buffer; pointedBy?: "meta" | "properties" | "guide" };
  encryptionXml?: string;
  extraEntries?: Record<string, Uint8Array>;
  compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

const DEFAULT_CHAPTERS: FixtureChapter[] = [
  { id: "ch1", file: "OEBPS/ch1.xhtml", title: "Chương 1", html: "<h1>Chương 1</h1><p>Nội dung một.</p>" },
];

const hrefInBook = (file: string) => file.replace(/^OEBPS\//, "");

export function buildEpubFixture(options: EpubFixtureOptions = {}): Buffer {
  const version = options.version ?? 3;
  const title = options.title ?? "Truyện thử";
  const author = options.author ?? "Tác giả";
  const language = options.language ?? "vi";
  const chapters = options.chapters ?? DEFAULT_CHAPTERS;

  const files: Record<string, Uint8Array> = {
    mimetype: new Uint8Array(Buffer.from("application/epub+zip")),
    "META-INF/container.xml": new Uint8Array(
      Buffer.from(
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
      )
    ),
  };

  const manifest: string[] = [];
  const spine: string[] = [];
  for (const chapter of chapters) {
    files[chapter.file] = new Uint8Array(
      Buffer.from(
        `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapter.title ?? ""}</title></head><body>${chapter.html}</body></html>`
      )
    );
    manifest.push(`<item id="${chapter.id}" href="${hrefInBook(chapter.file)}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${chapter.id}"/>`);
  }

  if (version === 3) {
    const links = chapters
      .filter((chapter) => chapter.title)
      .map((chapter) => `<li><a href="${hrefInBook(chapter.file)}">${chapter.title}</a></li>`)
      .join("");
    files["OEBPS/nav.xhtml"] = new Uint8Array(
      Buffer.from(
        `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${links}</ol></nav></body></html>`
      )
    );
    manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  } else {
    const points = chapters
      .filter((chapter) => chapter.title)
      .map(
        (chapter) =>
          `<navPoint id="np-${chapter.id}"><navLabel><text>${chapter.title}</text></navLabel><content src="${hrefInBook(chapter.file)}"/></navPoint>`
      )
      .join("");
    files["OEBPS/toc.ncx"] = new Uint8Array(
      Buffer.from(
        `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${points}</navMap></ncx>`
      )
    );
    manifest.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  }

  const metadata = [
    `<dc:title>${title}</dc:title>`,
    `<dc:creator>${author}</dc:creator>`,
    `<dc:language>${language}</dc:language>`,
  ];
  let guide = "";
  if (options.cover) {
    const { file, bytes, pointedBy = "meta" } = options.cover;
    files[file] = new Uint8Array(bytes);
    const properties = pointedBy === "properties" ? ` properties="cover-image"` : "";
    manifest.push(`<item id="cover-img" href="${hrefInBook(file)}" media-type="image/png"${properties}/>`);
    if (pointedBy === "meta") metadata.push(`<meta name="cover" content="cover-img"/>`);
    if (pointedBy === "guide") guide = `<guide><reference type="cover" href="${hrefInBook(file)}"/></guide>`;
  }

  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="${version === 3 ? "3.0" : "2.0"}" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${metadata.join("")}</metadata><manifest>${manifest.join("")}</manifest><spine${version === 2 ? ' toc="ncx"' : ""}>${spine.join("")}</spine>${guide}</package>`;
  files["OEBPS/content.opf"] = new Uint8Array(Buffer.from(opf));

  for (const [name, bytes] of Object.entries(options.extraEntries ?? {})) files[name] = bytes;
  if (options.encryptionXml) {
    files["META-INF/encryption.xml"] = new Uint8Array(Buffer.from(options.encryptionXml));
  }

  return Buffer.from(zipSync(files, { level: options.compressionLevel ?? 0 }));
}
