import { afterEach, describe, expect, it } from "vitest";
import {
  ArchiveLoanError,
  ArchiveLoginRequiredError,
  ArchiveNotBookError,
  ArchiveNotFoundError,
  ArchiveRestrictedError,
  ArchiveTooManyPagesError,
  ArchiveUnavailableError,
} from "./archiveErrors";
import { setLang } from "./lang";

afterEach(() => setLang(undefined));

describe("archive errors", () => {
  it("interpolate their argument into the English message", () => {
    expect(new ArchiveNotFoundError("abc").message).toBe("Internet Archive item not found: abc");
    expect(new ArchiveNotBookError("u").message).toContain("not a book: u");
    expect(new ArchiveRestrictedError("u").message).toContain("access-restricted");
    expect(new ArchiveUnavailableError("u").message).toContain("u");
    expect(new ArchiveTooManyPagesError(500).message).toContain("(maximum 500)");
    expect(new ArchiveLoginRequiredError("u").message).toContain("Sign in to archive.org");
  });

  it("are Error instances", () => {
    for (const e of [new ArchiveNotFoundError("a"), new ArchiveLoginRequiredError("a"), new ArchiveLoanError("m")]) {
      expect(e).toBeInstanceOf(Error);
    }
  });

  it("ArchiveLoanError keeps the message it was given", () => {
    expect(new ArchiveLoanError("custom").message).toBe("custom");
  });

  it("follows the current language", () => {
    setLang("vi");
    const msg = new ArchiveNotFoundError("abc").message;
    expect(msg).not.toBe("Internet Archive item not found: abc");
    expect(msg).toContain("abc");
    expect(msg).not.toContain("{id}");
  });
});
