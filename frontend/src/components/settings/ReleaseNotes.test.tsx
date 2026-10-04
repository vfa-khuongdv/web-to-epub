// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ReleaseNotes from "./ReleaseNotes";

import { renderEn } from "../../test/renderEn";

afterEach(cleanup);

describe("ReleaseNotes", () => {
  it("renders headings, bullets, bold, code and http links as elements", () => {
    const { container } = renderEn(
      <ReleaseNotes markdown={"## What's new\n\n- **Fast** reader\n- run `npm test`\n\nSee [docs](https://example.com/x)."} />
    );
    expect(screen.getByRole("heading", { name: "What's new" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Fast").tagName).toBe("STRONG");
    expect(screen.getByText("npm test").tagName).toBe("CODE");
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com/x");
    expect(link).toHaveAttribute("target", "_blank");
    expect(container.querySelector("script")).toBeNull();
  });

  it("never turns markup or javascript: links into elements", () => {
    const { container } = renderEn(<ReleaseNotes markdown={"<img src=x onerror=alert(1)> [bad](javascript:alert(1))"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing for empty notes", () => {
    const { container } = renderEn(<ReleaseNotes markdown={"  \n "} />);
    expect(container).toBeEmptyDOMElement();
  });
});
