// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdateInfo } from "../../types";
import { renderEn } from "../../test/renderEn";
import { UpdateDialog } from "./UpdateDialog";

const update: AppUpdateInfo = {
  current: "1.0.0",
  latest: "1.1.0",
  hasUpdate: true,
  releaseUrl: "https://example.com/release",
  zipUrl: "https://example.com/app.zip",
  notes: "## Changes\n\n- one",
};

let progress: ((p: ElectronUpdateProgress) => void) | undefined;
const unsubscribe = vi.fn();

function installBridge(install: (url: string) => Promise<void>) {
  window.electronUpdate = {
    install,
    onProgress: (cb) => {
      progress = cb;
      return unsubscribe;
    },
  };
}

beforeEach(() => {
  progress = undefined;
  unsubscribe.mockClear();
});
afterEach(() => {
  cleanup();
  delete window.electronUpdate;
});

describe("UpdateDialog (browser)", () => {
  it("shows versions, notes and a link to the release page", () => {
    renderEn(<UpdateDialog update={update} onDismiss={vi.fn()} />);
    expect(screen.getByText("A new version v1.1.0 is available (you have v1.0.0).")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Changes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the download page" })).toHaveAttribute("href", update.releaseUrl);
    expect(screen.queryByRole("button", { name: "Update now" })).toBeNull();
  });

  it("omits the notes section when there are none", () => {
    renderEn(<UpdateDialog update={{ ...update, notes: null }} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "What's new" })).toBeNull();
  });

  it("dismisses with Later, Escape and the backdrop", async () => {
    const onDismiss = vi.fn();
    renderEn(<UpdateDialog update={update} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onDismiss).toHaveBeenCalledTimes(3);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });
});

describe("UpdateDialog (packaged app)", () => {
  it("installs through the bridge, shows progress, and refuses to close while busy", async () => {
    const onDismiss = vi.fn();
    installBridge(() => new Promise(() => {}));
    renderEn(<UpdateDialog update={update} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(screen.getByRole("status")).toHaveTextContent("Downloading…");
    act(() => progress!({ received: 50, total: 200 }));
    expect(screen.getByRole("status")).toHaveTextContent("Downloading… 25%");
    expect(screen.getByRole("button", { name: "Later" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => progress!({ installing: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Installing…");
  });

  it("passes the zip url to install", async () => {
    const install = vi.fn(() => new Promise<void>(() => {}));
    installBridge(install);
    renderEn(<UpdateDialog update={update} onDismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(install).toHaveBeenCalledWith(update.zipUrl);
  });

  it("shows a failure and offers Try again", async () => {
    installBridge(() => Promise.reject(new Error("disk full")));
    renderEn(<UpdateDialog update={update} onDismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Update failed: disk full");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("unsubscribes from progress on unmount", () => {
    installBridge(async () => {});
    const { unmount } = renderEn(<UpdateDialog update={update} onDismiss={vi.fn()} />);
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
