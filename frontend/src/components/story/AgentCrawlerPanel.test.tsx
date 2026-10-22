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
    expect(rewriteMock).toHaveBeenCalledWith("s1", "");
    expect(screen.getByRole("button", { name: "Rewriting…" })).toBeDisabled();
    finish();
    expect(await screen.findByRole("status")).toHaveTextContent("The crawler was rewritten and the chapter list updated");
  });

  it("reloads the chapter list after a rewrite, and shows why when that fails", async () => {
    rewriteMock.mockResolvedValue();
    const reload = vi.fn().mockRejectedValueOnce(new Error("no list")).mockResolvedValue(undefined);
    renderEn(<AgentCrawlerPanel storyId="s1" onRewritten={reload} />);
    const button = await screen.findByRole("button", { name: "Rewrite the crawler with the agent" });
    await userEvent.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent("no list");
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("chapter list updated"));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("sends what the person says is wrong along with the rewrite", async () => {
    rewriteMock.mockResolvedValue();
    renderEn(<AgentCrawlerPanel storyId="s1" />);
    await userEvent.type(await screen.findByLabelText("What is wrong? (optional)"), " only 50 chapters ");
    await userEvent.click(screen.getByRole("button", { name: "Rewrite the crawler with the agent" }));
    expect(rewriteMock).toHaveBeenCalledWith("s1", "only 50 chapters");
  });

  it("shows the agent's failure", async () => {
    rewriteMock.mockRejectedValue(new Error("agent gave up"));
    renderEn(<AgentCrawlerPanel storyId="s1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Rewrite the crawler with the agent" }));
    expect(await screen.findByRole("status")).toHaveTextContent("agent gave up");
  });

  it("hides the rewrite action while the agent crawler is off, and says why", async () => {
    fetchMock.mockResolvedValue({ available: true, ready: false });
    renderEn(<AgentCrawlerPanel storyId="s1" />);
    expect(await screen.findByText("Turn the agent crawler on in Settings first.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rewrite the crawler with the agent" })).toBeNull();
  });
});
