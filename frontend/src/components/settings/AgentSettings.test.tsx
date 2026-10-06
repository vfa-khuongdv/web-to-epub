// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderEn } from "../../test/renderEn";

vi.mock("../../lib/api", () => ({ fetchAgentConfig: vi.fn(), saveAgentConfig: vi.fn() }));
import { fetchAgentConfig, saveAgentConfig } from "../../lib/api";
import type { AgentConfig } from "../../lib/api";
import AgentSettings, { AGENT_CONFIG_CHANGED } from "./AgentSettings";

const fetchMock = vi.mocked(fetchAgentConfig);
const saveMock = vi.mocked(saveAgentConfig);

const config = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  enabled: false,
  agent: null,
  model: "",
  ready: false,
  agents: [
    { id: "opencode", name: "opencode", installed: true },
    { id: "claude", name: "Claude Code", installed: true },
    { id: "codex", name: "Codex", installed: false },
  ],
  ...over,
});

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(config());
  saveMock.mockReset().mockResolvedValue();
});
afterEach(cleanup);

describe("AgentSettings", () => {
  it("says it is loading until the config loads and shows no picker while it is off", async () => {
    renderEn(<AgentSettings onSaved={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "Crawl any site with an agent" })).not.toBeChecked();
    expect(screen.queryByLabelText("Agent")).not.toBeInTheDocument();
  });

  it("reports a load failure through onError", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const onError = vi.fn();
    renderEn(<AgentSettings onSaved={vi.fn()} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith("boom"));
    expect(screen.getByText("Could not load the agent crawler settings")).toBeInTheDocument();
  });

  it("turning it on saves, reloads, announces the change and calls onSaved", async () => {
    const onSaved = vi.fn();
    const changed = vi.fn();
    window.addEventListener(AGENT_CONFIG_CHANGED, changed);
    renderEn(<AgentSettings onSaved={onSaved} onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Crawl any site with an agent" }));
    expect(saveMock).toHaveBeenCalledWith({ enabled: true });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(changed).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    window.removeEventListener(AGENT_CONFIG_CHANGED, changed);
  });

  it("lets the person pick an installed agent once it is on; one that is missing cannot be chosen", async () => {
    fetchMock.mockResolvedValue(config({ enabled: true, agent: "opencode", ready: true }));
    renderEn(<AgentSettings onSaved={vi.fn()} onError={vi.fn()} />);
    const picker = await screen.findByLabelText("Agent");
    expect(picker).toHaveValue("opencode");
    expect(screen.getByRole("option", { name: "Codex — not installed" })).toBeDisabled();
    await userEvent.selectOptions(picker, "claude");
    expect(saveMock).toHaveBeenCalledWith({ agent: "claude" });
  });

  it("saves the model when the field loses focus with a new value", async () => {
    fetchMock.mockResolvedValue(config({ enabled: true, agent: "opencode", ready: true }));
    renderEn(<AgentSettings onSaved={vi.fn()} onError={vi.fn()} />);
    const model = await screen.findByLabelText("Model");
    await userEvent.type(model, "sonnet");
    await userEvent.tab();
    expect(saveMock).toHaveBeenCalledWith({ model: "sonnet" });
  });

  it("says so, and cannot be turned on, when no agent is installed", async () => {
    fetchMock.mockResolvedValue(config({ agents: config().agents.map((a) => ({ ...a, installed: false })) }));
    renderEn(<AgentSettings onSaved={vi.fn()} onError={vi.fn()} />);
    expect(await screen.findByRole("checkbox", { name: "Crawl any site with an agent" })).toBeDisabled();
    expect(screen.getByText(/No agent found on this computer/)).toBeInTheDocument();
  });
});
