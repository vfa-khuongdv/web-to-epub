// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../i18n";
import type { ExtractedChapter } from "../../types";
import ChapterCard from "./ChapterCard";

beforeEach(() => localStorage.setItem("lang", "en"));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const okChapter: ExtractedChapter = {
  sourceUrl: "https://x.test/1",
  title: "T",
  blocks: [{ type: "paragraph", text: "Hello body" }],
};

type Props = Parameters<typeof ChapterCard>[0];

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    chapter: okChapter,
    order: 3,
    title: "Chap three",
    onTitleChange: vi.fn(),
    onRetry: vi.fn(),
    retrying: false,
    retriedOnce: false,
    onBodyChange: vi.fn(),
    ...over,
  };
  render(
    <LangProvider>
      <table>
        <tbody>
          <ChapterCard {...props} />
        </tbody>
      </table>
    </LangProvider>,
  );
  return props;
}

const open = () => userEvent.click(screen.getByRole("button", { name: /Chap three/ }));

describe("ChapterCard row", () => {
  it("shows order, title and Done chip; falls back to the URL as title", () => {
    setup();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    cleanup();
    setup({ title: "" });
    expect(screen.getByRole("button", { name: /https:\/\/x\.test\/1/ })).toBeInTheDocument();
  });

  it("expands and collapses, handing live HTML to the parent on collapse", async () => {
    const props = setup();
    const toggle = screen.getByRole("button", { name: /Chap three/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "Content for chapter 3" })).toHaveTextContent("Hello body");
    await userEvent.click(toggle);
    expect(props.onBodyChange).toHaveBeenCalledWith(expect.stringContaining("Hello body"));
    expect(screen.queryByRole("textbox", { name: /Content/ })).toBeNull();
  });

  it("shows chips for retrying and for each error kind", () => {
    setup({ chapter: { ...okChapter, error: "x" }, retrying: true });
    expect(screen.getByText("Retrying")).toBeInTheDocument();
    cleanup();
    setup({ chapter: { ...okChapter, error: "x", errorKind: "subscribers" } });
    expect(screen.getByText("Subscribers only")).toBeInTheDocument();
    cleanup();
    setup({ chapter: { ...okChapter, error: "x", errorKind: "mature" } });
    expect(screen.getByText("Rated M (18+)")).toBeInTheDocument();
    cleanup();
    setup({ chapter: { ...okChapter, error: "x", errorKind: "locked" } });
    expect(screen.getByText("Locked")).toBeInTheDocument();
    cleanup();
    setup({ chapter: { ...okChapter, error: "x", errorKind: "other" } });
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("retries a failed chapter from the row, but not for imported books", async () => {
    const props = setup({ chapter: { ...okChapter, error: "x" } });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(props.onRetry).toHaveBeenCalled();
    cleanup();
    setup({ chapter: { ...okChapter, error: "x" }, imported: true });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("re-crawl asks for confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Re-crawl" }));
    expect(props.onRetry).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Re-crawl" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("hides Re-crawl for imported books", () => {
    setup({ imported: true });
    expect(screen.queryByRole("button", { name: "Re-crawl" })).toBeNull();
  });
});

describe("ChapterCard delete", () => {
  it("confirms then deletes; cancel backs out", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    setup({ onDelete });
    await userEvent.click(screen.getByRole("button", { name: "Delete chapter 3" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete chapter 3" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("is disabled while crawling and absent without a handler", () => {
    setup({ onDelete: vi.fn(), deleteDisabled: true });
    expect(screen.getByRole("button", { name: "Delete chapter 3" })).toBeDisabled();
    cleanup();
    setup();
    expect(screen.queryByRole("button", { name: "Delete chapter 3" })).toBeNull();
  });
});

describe("ChapterCard audio and spell check", () => {
  it("plays, pauses (label follows state), and links to the download", async () => {
    const onPlayAudio = vi.fn();
    setup({ audioUrl: "/a.mp3", onPlayAudio });
    await userEvent.click(screen.getByRole("button", { name: "Listen to chapter 3" }));
    expect(onPlayAudio).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Download narration of chapter 3" })).toHaveAttribute("href", "/a.mp3");
    cleanup();
    setup({ audioUrl: "/a.mp3", onPlayAudio, audioPlaying: true });
    expect(screen.getByRole("button", { name: "Pause chapter 3" })).toBeInTheDocument();
  });

  it("regenerates only after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onRegenerateAudio = vi.fn();
    setup({ audioUrl: "/a.mp3", onRegenerateAudio });
    const btn = screen.getByRole("button", { name: "Regenerate audio of chapter 3" });
    await userEvent.click(btn);
    expect(onRegenerateAudio).not.toHaveBeenCalled();
    await userEvent.click(btn);
    expect(onRegenerateAudio).toHaveBeenCalledTimes(1);
  });

  it("offers Create audio only without audio, and respects regenerateDisabled", async () => {
    const onCreateAudio = vi.fn();
    setup({ onCreateAudio, regenerateDisabled: true });
    expect(screen.getByRole("button", { name: "Create audio for chapter 3" })).toBeDisabled();
    cleanup();
    setup({ onCreateAudio });
    await userEvent.click(screen.getByRole("button", { name: "Create audio for chapter 3" }));
    expect(onCreateAudio).toHaveBeenCalled();
    cleanup();
    setup({ onCreateAudio, audioUrl: "/a.mp3" });
    expect(screen.queryByRole("button", { name: "Create audio for chapter 3" })).toBeNull();
  });

  it("toggles the spelling mark and reflects aria-pressed", async () => {
    const onToggleSpellChecked = vi.fn().mockResolvedValue(undefined);
    setup({ onToggleSpellChecked, spellChecked: true });
    const btn = screen.getByRole("button", { name: "Spelling fixed in chapter 3" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(btn);
    expect(onToggleSpellChecked).toHaveBeenCalled();
  });
});

describe("ChapterCard editor", () => {
  it("marks dirty on title change, reports it, and Save writes title + live html", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const props = setup({ onSave });
    await open();
    const save = screen.getByRole("button", { name: "Save chapter" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title for chapter 3"), { target: { value: "Renamed" } });
    expect(props.onTitleChange).toHaveBeenCalledWith("Renamed");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledWith("Chap three", expect.stringContaining("Hello body"));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).toBeNull();
  });

  it("editing the body notifies the parent and enables saving", () => {
    const onSave = vi.fn();
    const props = setup({ onSave });
    return open().then(() => {
      const box = screen.getByRole("textbox", { name: "Content for chapter 3" });
      box.innerHTML = "<p>edited</p>";
      fireEvent.input(box);
      expect(props.onBodyChange).toHaveBeenCalledWith("<p>edited</p>");
      expect(screen.getByRole("button", { name: "Save chapter" })).toBeEnabled();
    });
  });

  it("shows the save error", async () => {
    setup({ onSave: vi.fn().mockRejectedValue(new Error("disk full")) });
    await open();
    fireEvent.change(screen.getByLabelText("Title for chapter 3"), { target: { value: "Z" } });
    await userEvent.click(screen.getByRole("button", { name: "Save chapter" }));
    expect(await screen.findByText("disk full")).toBeInTheDocument();
  });

  it("Undo restores the saved title and body", async () => {
    const props = setup({ onSave: vi.fn() });
    await open();
    fireEvent.change(screen.getByLabelText("Title for chapter 3"), { target: { value: "Z" } });
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(props.onTitleChange).toHaveBeenLastCalledWith("Chap three");
    expect(props.onBodyChange).toHaveBeenLastCalledWith(expect.stringContaining("Hello body"));
    expect(screen.queryByText("Unsaved")).toBeNull();
  });

  it("lazy-loads the body once and shows load errors, retrying on next open", async () => {
    const loadBody = vi.fn().mockRejectedValueOnce(new Error("net down")).mockResolvedValue("<p>Loaded text</p>");
    setup({ loadBody });
    await open();
    expect(await screen.findByText("net down")).toBeInTheDocument();
    await open(); // collapse
    await open(); // reopen -> retry
    expect(await screen.findByText("Loaded text")).toBeInTheDocument();
    expect(loadBody).toHaveBeenCalledTimes(2);
    await open();
    await open();
    expect(loadBody).toHaveBeenCalledTimes(2);
  });
});

describe("ChapterCard source URL", () => {
  it("shows the link, edits and saves a trimmed URL", async () => {
    const onSaveUrl = vi.fn().mockResolvedValue(undefined);
    setup({ onSaveUrl });
    await open();
    expect(screen.getByRole("link", { name: "https://x.test/1" })).toHaveAttribute("href", "https://x.test/1");
    await userEvent.click(screen.getByRole("button", { name: "Edit URL" }));
    const input = screen.getByLabelText("Source URL for chapter 3");
    await userEvent.clear(input);
    await userEvent.type(input, " https://y.test/2 ");
    await userEvent.click(screen.getByRole("button", { name: "Save URL" }));
    expect(onSaveUrl).toHaveBeenCalledWith("https://y.test/2");
    expect(screen.queryByLabelText("Source URL for chapter 3")).toBeNull();
  });

  it("reports a URL save error and can cancel", async () => {
    setup({ onSaveUrl: vi.fn().mockRejectedValue(new Error("bad url")) });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Edit URL" }));
    await userEvent.click(screen.getByRole("button", { name: "Save URL" }));
    expect(await screen.findByText("bad url")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit URL" })).toBeInTheDocument();
  });

  it("is not offered for imported books", async () => {
    setup({ imported: true, onSaveUrl: vi.fn() });
    await open();
    expect(screen.queryByText("Source:")).toBeNull();
  });
});

describe("ChapterCard failed chapter", () => {
  it("strips ANSI-ish call-log noise and offers Retry, hinting to try again first", async () => {
    const props = setup({ chapter: { ...okChapter, error: "Timeout [2m 30s[22m\nCall log" } });
    await open();
    expect(screen.getByText("Could not extract this chapter")).toBeInTheDocument();
    expect(screen.getByText(/Timeout 30s/)).toBeInTheDocument();
    expect(screen.getByText("Many errors are temporary — try again first.")).toBeInTheDocument();
    const retries = screen.getAllByRole("button", { name: "Retry" });
    await userEvent.click(retries[retries.length - 1]);
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("after a retry offers manual entry, which opens an editor tagged Manual input", async () => {
    setup({ chapter: { ...okChapter, error: "boom" }, retriedOnce: true });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Enter content manually" }));
    expect(screen.getByText("Manual input")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Content for chapter 3" })).toBeInTheDocument();
  });

  it.each([
    ["subscribers", "This chapter is for subscribers only", /Subscribe to the author/],
    ["mature", "This chapter is rated M \\(18\\+\\)", /Enable mature content/],
    ["locked", "This chapter is locked", /Unlock it on the site first/],
  ] as const)("explains a %s chapter", async (kind, heading, hint) => {
    setup({ chapter: { ...okChapter, error: "x", errorKind: kind } });
    await open();
    expect(screen.getByText(new RegExp(`^${heading}$`))).toBeInTheDocument();
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(screen.queryByText("Many errors are temporary — try again first.")).toBeNull();
  });
});
