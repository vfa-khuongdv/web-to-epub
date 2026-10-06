import { useRef, useState } from "react";
import { useLang } from "../../i18n";
import type { SupportedSite } from "../../types";
import { Icon } from "../ui/Icon";

// An import waiting for the reader's answer to "already in the library — overwrite?".
export type PendingImport = { kind: "file"; file: File } | { kind: "url"; url: string };

/**
 * The library's add box: the story URL field ("Load chapters"), the EPUB/PDF file picker
 * and drop zone, the overwrite question, and the list of supported sites. It owns only the
 * drag state; what adding does is the library's business.
 */
export default function AddStoryBox({
  storyUrl,
  onStoryUrl,
  busy,
  importBusy,
  onCreate,
  aiReady,
  onCreateAi,
  onImportFiles,
  pendingImport,
  onOverwrite,
  onCancelOverwrite,
  crawlSites,
  importSites,
}: {
  storyUrl: string;
  onStoryUrl: (value: string) => void;
  busy: boolean;
  importBusy: boolean;
  onCreate: () => void;
  // Agent crawler is on and its agent installed: offer the button that reads any site with it.
  aiReady: boolean;
  onCreateAi: () => void;
  onImportFiles: (files: FileList | null) => void;
  pendingImport: PendingImport | null;
  onOverwrite: () => void;
  onCancelOverwrite: () => void;
  crawlSites: SupportedSite[];
  importSites: SupportedSite[];
}) {
  const { t } = useLang();
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
  <div
    className={`border-b border-rule p-3${dragging ? " bg-sunken" : ""}`}
    onDragOver={(event) => {
      event.preventDefault();
      setDragging(true);
    }}
    onDragLeave={() => setDragging(false)}
    onDrop={(event) => {
      event.preventDefault();
      setDragging(false);
      onImportFiles(event.dataTransfer.files);
    }}
  >
    <div className="flex gap-2">
      <label className="visually-hidden" htmlFor="story-url">
        {t("Story page URL")}
      </label>
      <input
        id="story-url"
        type="text"
        className="input"
        placeholder="https://example.com/story-title/"
        value={storyUrl}
        onChange={(e) => onStoryUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCreate();
        }}
      />
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onCreate}>
        {busy ? t("Loading…") : t("Load chapters")}
      </button>
      {aiReady && (
        <button
          type="button"
          className="btn"
          disabled={busy}
          title={t("Read this page with the agent crawler, even if the site is not supported")}
          onClick={onCreateAi}
        >
          <Icon name="sparkles" size={13} />
          {t("Load with agent")}
        </button>
      )}
      <button type="button" className="btn" disabled={importBusy} onClick={() => fileInput.current?.click()}>
        <Icon name="upload" size={13} />
        {importBusy ? t("Importing…") : t("Import EPUB / PDF")}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".epub,application/epub+zip,.pdf,application/pdf"
        className="hidden"
        onChange={(event) => {
          onImportFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
    {pendingImport ? (
      <div className="banner banner-new mt-2">
        <Icon name="alert" size={14} />
        <p className="min-w-0">
          {t("This book is already in the library. Overwrite it with “{name}”?", {
            name: pendingImport.kind === "file" ? pendingImport.file.name : pendingImport.url,
          })}
        </p>
        <span className="ml-auto flex gap-1.5">
          <button
            type="button"
            className="btn btn-tiny btn-danger"
            disabled={busy || importBusy}
            onClick={onOverwrite}
          >
            {t("Overwrite")}
          </button>
          <button
            type="button"
            className="btn btn-tiny btn-quiet"
            disabled={importBusy}
            onClick={onCancelOverwrite}
          >
            {t("Cancel")}
          </button>
        </span>
      </div>
    ) : (
      <p className="mt-1.5 text-xs text-ink-3">
        {t("Paste a story page URL to load the full chapter list. Auto-loading sites:")}{" "}
        {[...new Set(crawlSites.map((s) => s.name))].join(", ") || t("loading…")}
        {/* The book-file sources are supported too, but they work the other way
            round, so they are named apart from the crawl sites. */}
        {importSites.length > 0 && (
          <span className="block">
            {t("Book sites (imported, not crawled):")}{" "}
            {[...new Set(importSites.map((s) => s.name))].join(", ")}
          </span>
        )}
        <span className="block">{t("Or drop an .epub or .pdf file here to import it.")}</span>
      </p>
    )}
  </div>
  );
}
