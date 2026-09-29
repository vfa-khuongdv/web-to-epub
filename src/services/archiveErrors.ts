import { t } from "./lang";

// An Internet Archive item whose catalog entry marks it lending/access-restricted is
// refused before any file is fetched. The app never borrows, signs in or decrypts.
export class ArchiveNotFoundError extends Error {
  constructor(id: string) {
    super(t("Internet Archive item not found: {id}", { id }));
  }
}

export class ArchiveNotBookError extends Error {
  constructor(url: string) {
    super(t("This Internet Archive item is not a book: {url}", { url }));
  }
}

export class ArchiveRestrictedError extends Error {
  constructor(url: string) {
    super(t("This Internet Archive item is access-restricted (borrow-only) and cannot be imported: {url}", { url }));
  }
}

export class ArchiveUnavailableError extends Error {
  constructor(url: string) {
    super(t("No readable EPUB, PDF, or text file is available for this Internet Archive item: {url}", { url }));
  }
}

export class ArchiveTooManyPagesError extends Error {
  constructor(count: number) {
    super(t("This Internet Archive book has too many pages to import (maximum {count})", { count }));
  }
}

/** Restricted item, no saved session: the fix is a login import, not a retry. */
export class ArchiveLoginRequiredError extends Error {
  constructor(url: string) {
    super(
      t(
        "This Internet Archive item is borrow-only. Sign in to archive.org (Settings → Site sessions) and import again: {url}",
        { url }
      )
    );
  }
}

/** A loan-level failure whose wording was already chosen at the throw site. */
export class ArchiveLoanError extends Error {}
