// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RepoDecoy from "./RepoDecoy";

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

describe("RepoDecoy", () => {
  it("draws pull request #482 with nothing that leads anywhere", () => {
    const { container } = render(<RepoDecoy />);
    expect(container.textContent).toContain("#482");
    expect(container.querySelector("[data-decoy-focus]")).not.toBeNull();
    // No link, form or media: nothing in the decoy can leave the page or load anything.
    expect(container.querySelectorAll("a[href], form, img, audio, video, iframe")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/chương|chapter|epub|novel|truyện/i);
  });

  it("works like a review: view a file, comment on a line, submit, see it in the conversation", () => {
    render(<RepoDecoy />);
    const tabs = screen.getByRole("navigation", { name: "Pull request" });
    fireEvent.click(within(tabs).getByRole("button", { name: /Files changed/ }));

    const file = screen.getByRole("region", { name: "src/common/money.ts" });
    fireEvent.click(within(file).getByRole("checkbox", { name: "Viewed" }));
    expect(screen.getByText("1 / 6 files viewed")).toBeInTheDocument();
    // A viewed file folds away; its button opens it again.
    fireEvent.click(within(file).getByRole("button", { name: "Expand file" }));

    fireEvent.click(within(file).getByRole("button", { name: "Add a comment on line R5" }));
    fireEvent.change(within(file).getByRole("textbox", { name: "Comment on line R5" }), { target: { value: "Thêm test cho USD nhé" } });
    fireEvent.click(within(file).getByRole("button", { name: "Start a review" }));
    expect(within(file).getByText("Pending")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Finish your review/ }));
    const dialog = screen.getByRole("dialog", { name: "Finish your review" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Review summary" }), { target: { value: "Gần xong rồi" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Approve/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit review" }));

    // Back on the conversation, the review and its line comment are there.
    expect(screen.getByText("Gần xong rồi")).toBeInTheDocument();
    expect(screen.getByText("Thêm test cho USD nhé")).toBeInTheDocument();
    expect(screen.getAllByText("approved these changes").length).toBeGreaterThan(1);
  });

  it("merges after confirming, and keeps that when shown again", () => {
    const first = render(<RepoDecoy />);
    fireEvent.click(screen.getByRole("button", { name: "Squash and merge" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm squash and merge" }));
    expect(screen.getByText("Pull request successfully merged and closed")).toBeInTheDocument();
    first.unmount();

    render(<RepoDecoy />);
    expect(screen.getByText("Pull request successfully merged and closed")).toBeInTheDocument();
  });
});
