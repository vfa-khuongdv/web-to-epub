// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LangProvider } from "../../i18n";
import StoryDetailSkeleton from "./StoryDetailSkeleton";

beforeEach(() => localStorage.setItem("lang", "en"));
afterEach(cleanup);

describe("StoryDetailSkeleton", () => {
  it("announces loading through a status region outside the hidden blocks", () => {
    const { container } = render(
      <LangProvider>
        <StoryDetailSkeleton />
      </LangProvider>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading story details");
    expect(status.closest("[aria-hidden='true']")).toBeNull();
    expect(screen.getByRole("heading", { name: "Story details" })).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(12);
  });
});
