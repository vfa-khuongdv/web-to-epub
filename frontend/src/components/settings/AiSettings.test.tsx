// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderEn } from "../../test/renderEn";

vi.mock("../../lib/api", () => ({ fetchAiConfig: vi.fn(), saveAiConfig: vi.fn() }));
import { fetchAiConfig, saveAiConfig } from "../../lib/api";
import type { AiConfig } from "../../lib/api";
import AiSettings, { AI_CONFIG_CHANGED } from "./AiSettings";

const fetchMock = vi.mocked(fetchAiConfig);
const saveMock = vi.mocked(saveAiConfig);

const config = (over: Partial<AiConfig> = {}): AiConfig => ({
  enabled: false,
  active: "deepseek",
  providers: [
    { id: "deepseek", name: "DeepSeek", baseUrl: "https://ds", model: "ds-chat", keyRequired: true, hasKey: false },
    { id: "openai", name: "OpenAI", baseUrl: "https://oa", model: "gpt", keyRequired: true, hasKey: true },
  ],
  ...over,
});

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(config());
  saveMock.mockReset().mockResolvedValue();
});
afterEach(cleanup);

describe("AiSettings", () => {
  it("renders nothing until the config loads, then fills fields from the active provider", async () => {
    const { container } = renderEn(<AiSettings onSaved={vi.fn()} onError={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("ds-chat"));
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://ds");
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.getByRole("option", { name: "OpenAI ✓" })).toBeInTheDocument();
  });

  it("reports a load failure through onError", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const onError = vi.fn();
    renderEn(<AiSettings onSaved={vi.fn()} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith("boom"));
  });

  it("saves the toggle, reloads, announces the change and calls onSaved", async () => {
    const onSaved = vi.fn();
    const changed = vi.fn();
    window.addEventListener(AI_CONFIG_CHANGED, changed);
    renderEn(<AiSettings onSaved={onSaved} onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Crawl any site with AI" }));
    expect(saveMock).toHaveBeenCalledWith({ enabled: true });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(changed).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    window.removeEventListener(AI_CONFIG_CHANGED, changed);
  });

  it("switches provider", async () => {
    renderEn(<AiSettings onSaved={vi.fn()} onError={vi.fn()} />);
    await userEvent.selectOptions(await screen.findByLabelText("AI provider"), "openai");
    expect(saveMock).toHaveBeenCalledWith({ active: "openai" });
  });

  it("saves the typed key, model and base URL for the active provider", async () => {
    renderEn(<AiSettings onSaved={vi.fn()} onError={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("API key"), "sk-1");
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("ds-chat"));
    await userEvent.clear(screen.getByLabelText("Model"));
    await userEvent.type(screen.getByLabelText("Model"), "m2");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveMock).toHaveBeenCalledWith({
      providers: { deepseek: { apiKey: "sk-1", model: "m2", baseUrl: "https://ds" } },
    });
    await waitFor(() => expect(screen.getByLabelText("API key")).toHaveValue(""));
  });

  it("hints that a saved key is kept, and reports save errors", async () => {
    fetchMock.mockResolvedValue(config({ active: "openai" }));
    saveMock.mockRejectedValue(new Error("nope"));
    const onError = vi.fn();
    renderEn(<AiSettings onSaved={vi.fn()} onError={onError} />);
    expect(await screen.findByPlaceholderText("Key saved — type to replace")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("nope"));
  });
});
