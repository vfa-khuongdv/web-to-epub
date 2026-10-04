// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../i18n";
import PendingChapterRow from "./PendingChapterRow";

beforeEach(() => localStorage.setItem("lang", "en"));
afterEach(cleanup);

function setup(props: Partial<Parameters<typeof PendingChapterRow>[0]> = {}) {
  render(
    <LangProvider>
      <table>
        <tbody>
          <PendingChapterRow order={7} title="Old title" url="https://x.test/7" {...props} />
        </tbody>
      </table>
    </LangProvider>,
  );
}

describe("PendingChapterRow", () => {
  it("shows order, title, state chip and a source link", () => {
    setup();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Old title")).toBeInTheDocument();
    expect(screen.getByText("Pending crawl")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open source page for chapter 7" })).toHaveAttribute("href", "https://x.test/7");
  });

  it("falls back to the URL when the title is empty and honours state", () => {
    setup({ title: "", state: "running" });
    expect(screen.getByText("https://x.test/7")).toBeInTheDocument();
    expect(screen.getByText("Crawling")).toBeInTheDocument();
  });

  it("hides edit and delete without handlers", () => {
    setup();
    expect(screen.queryByRole("button", { name: /Edit title/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete chapter/ })).toBeNull();
  });

  it("saves a trimmed title and leaves edit mode", async () => {
    const onSaveTitle = vi.fn().mockResolvedValue(undefined);
    setup({ onSaveTitle });
    await userEvent.click(screen.getByRole("button", { name: "Edit title for chapter 7" }));
    const input = screen.getByLabelText("Title for chapter 7");
    await userEvent.clear(input);
    await userEvent.type(input, "  New  ");
    await userEvent.click(screen.getByRole("button", { name: "Save title" }));
    expect(onSaveTitle).toHaveBeenCalledWith("New");
    expect(screen.queryByLabelText("Title for chapter 7")).toBeNull();
  });

  it("does not save a blank title", async () => {
    const onSaveTitle = vi.fn();
    setup({ onSaveTitle });
    await userEvent.click(screen.getByRole("button", { name: "Edit title for chapter 7" }));
    await userEvent.clear(screen.getByLabelText("Title for chapter 7"));
    expect(screen.getByRole("button", { name: "Save title" })).toBeDisabled();
    expect(onSaveTitle).not.toHaveBeenCalled();
  });

  it("shows the error and stays in edit mode when saving fails; cancel restores", async () => {
    setup({ onSaveTitle: vi.fn().mockRejectedValue(new Error("boom")) });
    await userEvent.click(screen.getByRole("button", { name: "Edit title for chapter 7" }));
    await userEvent.click(screen.getByRole("button", { name: "Save title" }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Old title")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting, and cancel backs out", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    setup({ onDelete });
    await userEvent.click(screen.getByRole("button", { name: "Delete chapter 7" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete chapter 7" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirm open when delete rejects", async () => {
    setup({ onDelete: vi.fn().mockRejectedValue(new Error("x")) });
    await userEvent.click(screen.getByRole("button", { name: "Delete chapter 7" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("disables the delete trigger while crawling", () => {
    setup({ onDelete: vi.fn(), deleteDisabled: true });
    expect(screen.getByRole("button", { name: "Delete chapter 7" })).toBeDisabled();
  });
});
