// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderEn } from "../../test/renderEn";

vi.mock("../../lib/api", () => ({ fetchStoryAgentCrawler: vi.fn(), rewriteStoryAgentCrawler: vi.fn() }));
import { fetchStoryAgentCrawler, rewriteStoryAgentCrawler } from "../../lib/api";
import AgentCrawlerPanel from "./AgentCrawlerPanel";

const fetchMock = vi.mocked(fetchStoryAgentCrawler);
const rewriteMock = vi.mocked(rewriteStoryAgentCrawler);

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ available: true, ready: true });
  rewriteMock.mockReset().mockResolvedValue();
});
afterEach(cleanup);

describe("AgentCrawlerPanel", () => {
  it("shows nothing for a site the agent did not write code for", async () => {
    fetchMock.mockResolvedValue({ available: false, ready: true });
    const { container } = renderEn(<AgentCrawlerPanel storyId="s1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("s1"));
    expect(container).toBeEmptyDOMElement();
  });

  it("rewrites on the button, disabled while it runs, then says to reload the chapters", async () => {
    let finish!: () => void;
    rewriteMock.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    renderEn(<AgentCrawlerPanel storyId="s1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Rewrite the crawler with the agent" }));
    expect(rewriteMock).toHaveBeenCalledWith("s1");
    expect(screen.getByRole("button", { name: "Rewriting…" })).toBeDisabled();
    finish();
    expect(await screen.findByRole("status")).toHaveTextContent("The crawler was rewritten");
  });

  it("shows the agent's failure", async () => {
    rewriteMock.mockRejectedValue(new Error("agent gave up"));
    renderEn(<AgentCrawlerPanel storyId="s1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Rewrite the crawler with the agent" }));
    expect(await screen.findByRole("status")).toHaveTextContent("agent gave up");
  });

  it("cannot rewrite while the agent crawler is off, and says why", async () => {
    fetchMock.mockResolvedValue({ available: true, ready: false });
    renderEn(<AgentCrawlerPanel storyId="s1" />);
    expect(await screen.findByRole("button", { name: "Rewrite the crawler with the agent" })).toBeDisabled();
    expect(screen.getByText("Turn the agent crawler on in Settings first.")).toBeInTheDocument();
  });
});
