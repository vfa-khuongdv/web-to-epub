// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderEn } from "../../test/renderEn";

const api = vi.hoisted(() => ({ fetchIllustrated: vi.fn(), drawCharacters: vi.fn(), removeCharacters: vi.fn() }));
vi.mock("../../lib/api", () => api);

import { VideoStyle } from "./VideoStyle";

const face = '<g><circle r="5"/></g>';
const bible = {
  style: "flat",
  characters: [{ id: "a", name: "Lan", description: "tóc đen", body: "<g></g>", headY: -380, faces: { neutral: face, smile: face, sad: face, surprised: face, laugh: face } }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("VideoStyle", () => {
  it("shows nothing but the choice while the cover style is selected", async () => {
    api.fetchIllustrated.mockResolvedValue({ bible: null, agentAvailable: true });
    renderEn(<VideoStyle storyId="s" value="cover" onChange={vi.fn()} onReady={vi.fn()} />);
    expect(await screen.findByLabelText("Video style")).toHaveValue("cover");
    expect(screen.queryByRole("button", { name: "Draw the characters" })).not.toBeInTheDocument();
  });

  it("switches style, draws the characters and reports readiness", async () => {
    api.fetchIllustrated.mockResolvedValue({ bible: null, agentAvailable: true });
    api.drawCharacters.mockResolvedValue({ bible, agentAvailable: true });
    const onReady = vi.fn();
    const onChange = vi.fn();
    renderEn(<VideoStyle storyId="s" value="illustrated" onChange={onChange} onReady={onReady} />);

    await waitFor(() => expect(onReady).toHaveBeenCalledWith(false));
    await userEvent.selectOptions(screen.getByLabelText("Video style"), "cover");
    expect(onChange).toHaveBeenCalledWith("cover");

    await userEvent.click(await screen.findByRole("button", { name: "Draw the characters" }));
    expect(await screen.findByRole("img", { name: "Lan" })).toBeInTheDocument();
    expect(api.drawCharacters).toHaveBeenCalledWith("s");
    expect(onReady).toHaveBeenLastCalledWith(true);
  });

  it("asks before drawing again and refuses to draw without an agent", async () => {
    api.fetchIllustrated.mockResolvedValue({ bible, agentAvailable: true });
    vi.stubGlobal("confirm", vi.fn(() => false));
    renderEn(<VideoStyle storyId="s" value="illustrated" onChange={vi.fn()} onReady={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Draw again" }));
    expect(api.drawCharacters).not.toHaveBeenCalled();
    cleanup();

    api.fetchIllustrated.mockResolvedValue({ bible: null, agentAvailable: false });
    renderEn(<VideoStyle storyId="s" value="illustrated" onChange={vi.fn()} onReady={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Draw the characters" })).toBeDisabled();
  });

  it("shows why drawing failed", async () => {
    api.fetchIllustrated.mockResolvedValue({ bible: null, agentAvailable: true });
    api.drawCharacters.mockRejectedValue(new Error("agent failed"));
    renderEn(<VideoStyle storyId="s" value="illustrated" onChange={vi.fn()} onReady={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Draw the characters" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("agent failed");
  });
});
