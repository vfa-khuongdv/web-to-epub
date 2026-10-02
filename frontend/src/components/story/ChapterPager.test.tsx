// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../i18n";
import ChapterPager from "./ChapterPager";

beforeEach(() => localStorage.setItem("lang", "en"));
afterEach(cleanup);

function setup(props: Partial<Parameters<typeof ChapterPager>[0]> = {}) {
  const onPage = vi.fn();
  render(
    <LangProvider>
      <ChapterPager page={2} pageCount={5} perPage={50} total={230} onPage={onPage} {...props} />
    </LangProvider>,
  );
  return onPage;
}

describe("ChapterPager", () => {
  it("shows the slice and page numbers", () => {
    setup();
    expect(screen.getByText("Chapters 51–100 / 230")).toBeInTheDocument();
    expect(screen.getByText("Page 2/5")).toBeInTheDocument();
  });

  it("clamps the last slice to the total", () => {
    setup({ page: 5 });
    expect(screen.getByText("Chapters 201–230 / 230")).toBeInTheDocument();
  });

  it("calls onPage with neighbouring pages", async () => {
    const onPage = setup();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPage).toHaveBeenLastCalledWith(1);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenLastCalledWith(3);
  });

  it("disables Previous on the first page and Next on the last", () => {
    setup({ page: 1 });
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    cleanup();
    setup({ page: 5 });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
