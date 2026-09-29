/**
 * Fixtures shaped like the live archive.org responses probed during design
 * (see docs/superpowers/specs/2026-09-29-archive-borrow-import-design.md §2).
 * Shared by archiveBorrow.test.ts, archiveImport.test.ts and the import route test.
 */

// Minimal JPEG magic bytes — the capture only checks the header before storing.
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]);

// The details page carries the reader config url in a hidden input; & must be
// escaped as in real HTML so JSDOM decodes it back on .value.
export function detailsHtml(configUrl = defaultConfigUrl()): string {
  const value = JSON.stringify({ url: configUrl }).replace(/&/g, "&amp;").replace(/'/g, "&#39;");
  return `<html><head><title>x</title></head><body><input class="js-bookreader" type="hidden" value='${value}'></body></html>`;
}

export function defaultConfigUrl(): string {
  return (
    "//ia601804.us.archive.org/BookReader/BookReaderJSIA.php?id=testitem" +
    "&itemPath=/24/items/testitem&server=ia601804.us.archive.org" +
    "&format=jsonp&subPrefix=testitem&requestUri=/details/testitem/mode/2up"
  );
}

export interface JsiaOverrides {
  leafCount?: number;
  bookTitle?: string;
  lendingStatus?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// BookReaderJSIA.php?format=json → { data: { brOptions, lendingInfo, metadata } }.
export function jsiaBody(overrides: JsiaOverrides = {}) {
  const leafCount = overrides.leafCount ?? 3;
  const leaves = Array.from({ length: leafCount }, (_, index) => ({
    leafNum: index + 1,
    uri:
      "https://ia601804.us.archive.org/BookReader/BookReaderPreview.php" +
      `?id=testitem&subPrefix=testitem&itemPath=/24/items/testitem` +
      `&server=ia601804.us.archive.org&page=leaf${index + 1}&fail=preview&`,
    width: 1414,
    height: 2048,
    pageType: index < 2 ? "Cover" : "Normal",
    viewable: true,
  }));
  return {
    data: {
      brOptions: {
        bookId: "testitem",
        subPrefix: "testitem",
        bookPath: "/24/items/testitem/testitem",
        server: "ia601804.us.archive.org",
        imageFormat: "jp2",
        bookTitle: overrides.bookTitle ?? "Namiya zakkaten no kiseki",
        data: [leaves],
      },
      lendingInfo: {
        lendingStatus: {
          is_lendable: true,
          active_borrows: 0,
          active_browses: 1,
          available_to_borrow: false,
          available_to_browse: false,
          ...overrides.lendingStatus,
        },
      },
      metadata: { identifier: "testitem", title: "Namiya zakkaten no kiseki", creator: "Keigo Higashino", language: "jpn", ...overrides.metadata },
    },
  };
}
