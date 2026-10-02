// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_SITES } from "../../lib/sources/siteSessions";
import { renderEn } from "../../test/renderEn";

vi.mock("../../lib/api", () => ({ importSiteSession: vi.fn() }));
import { importSiteSession } from "../../lib/api";
import SiteSessionDialog from "./SiteSessionDialog";

const site = SESSION_SITES[0];
const importMock = vi.mocked(importSiteSession);

beforeEach(() => {
  importMock.mockReset();
});
afterEach(cleanup);

describe("SiteSessionDialog", () => {
  it("renders the site's copy and keeps Save disabled until something is pasted", async () => {
    renderEn(<SiteSessionDialog site={site} onSaved={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: site.dialogTitle })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(site.dialogSteps.length);
    const save = screen.getByRole("button", { name: "Save session" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("cURL from your browser"), "   ");
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("cURL from your browser"), "curl x");
    expect(save).toBeEnabled();
  });

  it("imports the pasted cURL and reports the result", async () => {
    importMock.mockResolvedValue({ cookieCount: 2, username: "bob" });
    const onSaved = vi.fn();
    renderEn(<SiteSessionDialog site={site} onSaved={onSaved} onSkip={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("cURL from your browser"), "curl http://x");
    await userEvent.click(screen.getByRole("button", { name: "Save session" }));
    expect(importMock).toHaveBeenCalledWith(site.slug, "curl http://x");
    expect(onSaved).toHaveBeenCalledWith({ cookieCount: 2, username: "bob" });
  });

  it("shows the server's error and stays open", async () => {
    importMock.mockRejectedValue(new Error("no login cookies"));
    const onSaved = vi.fn();
    renderEn(<SiteSessionDialog site={site} onSaved={onSaved} onSkip={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("cURL from your browser"), "curl x");
    await userEvent.click(screen.getByRole("button", { name: "Save session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no login cookies");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save session" })).toBeEnabled();
  });

  it("disables the form while saving", async () => {
    importMock.mockReturnValue(new Promise(() => {}));
    renderEn(<SiteSessionDialog site={site} onSaved={vi.fn()} onSkip={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("cURL from your browser"), "curl x");
    await userEvent.click(screen.getByRole("button", { name: "Save session" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
  });

  it("skips with the button, Escape and the backdrop", async () => {
    const onSkip = vi.fn();
    renderEn(<SiteSessionDialog site={site} onSaved={vi.fn()} onSkip={onSkip} />);
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onSkip).toHaveBeenCalledTimes(3);
  });
});
