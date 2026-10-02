// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../i18n";
import StoryMetaFields from "./StoryMetaFields";

beforeEach(() => localStorage.setItem("lang", "en"));
afterEach(cleanup);

function setup() {
  const h = { onBookTitle: vi.fn(), onAuthor: vi.fn(), onLanguage: vi.fn(), onCoverFile: vi.fn() };
  const coverInput = createRef<HTMLInputElement>();
  render(
    <LangProvider>
      <StoryMetaFields bookTitle="My Book" author="Ann" language="vi" coverInput={coverInput} {...h} />
    </LangProvider>,
  );
  return { ...h, coverInput };
}

describe("StoryMetaFields", () => {
  it("renders the controlled values", () => {
    setup();
    expect(screen.getByLabelText("Book title")).toHaveValue("My Book");
    expect(screen.getByLabelText("Author")).toHaveValue("Ann");
    expect(screen.getByLabelText("Book language")).toHaveValue("vi");
  });

  it("reports edits to title, author and language", async () => {
    const h = setup();
    await userEvent.type(screen.getByLabelText("Book title"), "!");
    expect(h.onBookTitle).toHaveBeenCalledWith("My Book!");
    await userEvent.type(screen.getByLabelText("Author"), "x");
    expect(h.onAuthor).toHaveBeenCalledWith("Annx");
    await userEvent.selectOptions(screen.getByLabelText("Book language"), "en");
    expect(h.onLanguage).toHaveBeenCalledWith("en");
  });

  it("passes the chosen cover file, or null when cleared, and exposes the input ref", async () => {
    const h = setup();
    const input = screen.getByLabelText("Cover image") as HTMLInputElement;
    expect(h.coverInput.current).toBe(input);
    const file = new File(["x"], "c.png", { type: "image/png" });
    await userEvent.upload(input, file);
    expect(h.onCoverFile).toHaveBeenLastCalledWith(file);
    fireEvent.change(input, { target: { files: [] } });
    expect(h.onCoverFile).toHaveBeenLastCalledWith(null);
  });
});
