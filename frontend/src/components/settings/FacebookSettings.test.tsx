// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderEn } from "../../test/renderEn";

const api = vi.hoisted(() => ({ fetchFacebookStatus: vi.fn(), connectFacebook: vi.fn(), disconnectFacebook: vi.fn() }));
vi.mock("../../lib/api", () => api);

import FacebookSettings from "./FacebookSettings";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("FacebookSettings", () => {
  it("connects with the Page id and token, then clears the token", async () => {
    api.fetchFacebookStatus.mockResolvedValue({ connected: false });
    api.connectFacebook.mockResolvedValue({ connected: true, pageName: "Truyện FM" });
    const onSaved = vi.fn();
    renderEn(<FacebookSettings onSaved={onSaved} onError={vi.fn()} />);

    const button = await screen.findByRole("button", { name: "Connect Facebook" });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Page id"), "123456");
    await userEvent.type(screen.getByLabelText("Page access token"), "secret");
    await userEvent.click(button);

    await waitFor(() => expect(api.connectFacebook).toHaveBeenCalledWith("123456", "secret"));
    expect(await screen.findByText("Connected: Truyện FM")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows the server's refusal", async () => {
    api.fetchFacebookStatus.mockResolvedValue({ connected: false });
    api.connectFacebook.mockRejectedValue(new Error("token expired"));
    const onError = vi.fn();
    renderEn(<FacebookSettings onSaved={vi.fn()} onError={onError} />);
    await userEvent.type(await screen.findByLabelText("Page id"), "123456");
    await userEvent.type(screen.getByLabelText("Page access token"), "bad");
    await userEvent.click(screen.getByRole("button", { name: "Connect Facebook" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("token expired"));
  });

  it("disconnects after a confirmation", async () => {
    api.fetchFacebookStatus.mockResolvedValue({ connected: true, pageName: "Truyện FM" });
    api.disconnectFacebook.mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    renderEn(<FacebookSettings onSaved={vi.fn()} onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(api.disconnectFacebook).toHaveBeenCalled());
    expect(await screen.findByText("Not connected to Facebook yet.")).toBeInTheDocument();
  });
});
