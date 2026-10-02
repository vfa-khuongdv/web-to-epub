// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderEn } from "../test/renderEn";

vi.mock("../lib/api", () => ({ fetchVaultStatus: vi.fn(), openVault: vi.fn(), closeVault: vi.fn() }));
import { closeVault, fetchVaultStatus, openVault } from "../lib/api";
import { currentVaultToken, noteVaultExpired, setVaultToken } from "./token";
import { useVault, VaultProvider } from "./index";

const status = vi.mocked(fetchVaultStatus);
const open = vi.mocked(openVault);
const close = vi.mocked(closeVault);

function Probe() {
  const v = useVault();
  return <p data-testid="state">{v.active ? "private" : "public"}</p>;
}

function mount() {
  return renderEn(
    <VaultProvider>
      <Probe />
    </VaultProvider>
  );
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key, shiftKey: true, ctrlKey: true, ...init });

beforeEach(() => {
  status.mockReset().mockResolvedValue({ configured: true });
  open.mockReset().mockResolvedValue("tok-1");
  close.mockReset().mockResolvedValue();
  setVaultToken(null);
});
afterEach(cleanup);

describe("VaultProvider", () => {
  it("starts public with no prompt", () => {
    mount();
    expect(screen.getByTestId("state")).toHaveTextContent("public");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(status).not.toHaveBeenCalled();
  });

  it("ignores other key combinations", () => {
    mount();
    press("n", { shiftKey: false });
    press("n", { ctrlKey: false });
    press("n", { altKey: true });
    press("x");
    expect(status).not.toHaveBeenCalled();
  });

  it("opens the unlock prompt on Ctrl+Shift+N when a code exists, then unlocks", async () => {
    mount();
    press("N");
    expect(await screen.findByRole("dialog", { name: "Private mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    await userEvent.keyboard("123456");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("private"));
    expect(open).toHaveBeenCalledWith("123456", "unlock");
    expect(currentVaultToken()).toBe("tok-1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cmd+Shift+K works too and sets up when no code is configured", async () => {
    status.mockResolvedValue({ configured: false });
    mount();
    press("k", { ctrlKey: false, metaKey: true });
    expect(await screen.findByRole("button", { name: "Create" })).toBeInTheDocument();
    await userEvent.keyboard("123456123456");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("123456", "setup"));
  });

  it("falls back to the unlock prompt when the status check fails", async () => {
    status.mockRejectedValue(new Error("offline"));
    mount();
    press("n");
    expect(await screen.findByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("the same keys leave private mode, locking the server session and dropping the token", async () => {
    mount();
    press("n");
    await screen.findByRole("dialog");
    await userEvent.keyboard("123456");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("private"));
    press("n");
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("public"));
    expect(close).toHaveBeenCalled();
    expect(currentVaultToken()).toBeNull();
  });

  it("falls back to public when the server expires the session", async () => {
    mount();
    press("n");
    await screen.findByRole("dialog");
    await userEvent.keyboard("123456");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("private"));
    act(() => noteVaultExpired());
    expect(screen.getByTestId("state")).toHaveTextContent("public");
  });

  it("Escape closes the prompt", async () => {
    mount();
    press("n");
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
