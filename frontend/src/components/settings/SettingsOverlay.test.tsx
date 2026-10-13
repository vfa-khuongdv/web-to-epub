// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo, AppSettings } from "../../types";
import { renderEn } from "../../test/renderEn";

vi.mock("../../lib/api", () => ({
  changeVaultCode: vi.fn(),
  fetchSettings: vi.fn(),
  fetchSiteSession: vi.fn(),
  removeSiteSession: vi.fn(),
  saveSettings: vi.fn(),
  importSiteSession: vi.fn(),
}));
// The three feature sections have their own tests; here they only need to be present.
vi.mock("../narration/NarrationSettings", () => ({ default: () => <div>narration-section</div> }));
vi.mock("../narration/MusicPicker", () => ({ MusicSettings: () => <div>music-section</div> }));
vi.mock("./YouTubeSettings", () => ({
  default: () => <div>youtube-section</div>,
  YOUTUBE_CONNECTED: "youtube-connected",
}));
vi.mock("./FacebookSettings", () => ({ default: () => <div>facebook-section</div> }));
vi.mock("./AgentSettings", () => ({
  default: ({ onSaved, onError }: { onSaved: () => void; onError: (m: string) => void }) => (
    <div>
      ai-section
      <button onClick={onSaved}>ai-saved</button>
      <button onClick={() => onError("ai broke")}>ai-error</button>
    </div>
  ),
}));
import { changeVaultCode, fetchSettings, fetchSiteSession, importSiteSession, removeSiteSession, saveSettings } from "../../lib/api";
import SettingsOverlay from "./SettingsOverlay";

const m = {
  fetchSettings: vi.mocked(fetchSettings),
  save: vi.mocked(saveSettings),
  session: vi.mocked(fetchSiteSession),
  removeSession: vi.mocked(removeSiteSession),
  importSession: vi.mocked(importSiteSession),
  changeCode: vi.mocked(changeVaultCode),
};

const settings: AppSettings = {
  autoScanOnOpen: false,
  defaultBookLanguage: "vi",
  defaultAuthor: "",
  ttsVariant: "turbo",
  ttsVoice: "",
  narrationIntro: true,
  narrationIntroText: "",
};
const app: AppInfo = { version: "1.7.0", dataDir: "/data/lib", storyCount: 4, chapterCount: 99, privateConfigured: false };

function setup(over: { onClose?: () => void; onSaved?: () => void; onTheme?: () => void } = {}) {
  const props = { theme: "light" as const, onTheme: vi.fn(), onSaved: vi.fn(), onClose: vi.fn(), ...over };
  renderEn(<SettingsOverlay {...props} />);
  return props;
}

beforeEach(() => {
  m.fetchSettings.mockReset().mockResolvedValue({ settings, app });
  m.save.mockReset().mockImplementation(async (patch) => ({ ...settings, ...patch }));
  m.session.mockReset().mockResolvedValue({ configured: false });
  m.removeSession.mockReset().mockResolvedValue();
  m.importSession.mockReset();
  m.changeCode.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SettingsOverlay loading", () => {
  it("shows a skeleton, then the sections and About facts", async () => {
    setup();
    expect(screen.getByText("Loading settings")).toBeInTheDocument();
    expect(await screen.findByText("Appearance")).toBeInTheDocument();
    for (const title of ["Library", "New book defaults", "Narration", "Background music", "Private mode", "Agent crawler", "Site sessions", "About"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText("1.7.0")).toBeInTheDocument();
    expect(screen.getByText("/data/lib")).toBeInTheDocument();
    expect(screen.getByText("4 stories, 99 chapters")).toBeInTheDocument();
  });

  it("shows a load error and retries", async () => {
    m.fetchSettings.mockRejectedValueOnce(new Error("db locked"));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("db locked");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Appearance")).toBeInTheDocument();
    expect(m.fetchSettings).toHaveBeenCalledTimes(2);
  });

  it("closes with the button and with Escape", async () => {
    const props = setup();
    await screen.findByText("Appearance");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});

describe("SettingsOverlay saving", () => {
  it("saves the scan toggle, tells the parent and flashes Saved", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const props = setup();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Check for new chapters when the app opens" }));
    expect(m.save).toHaveBeenCalledWith({ autoScanOnOpen: true });
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith({ ...settings, autoScanOnOpen: true }));
    expect(screen.getByRole("checkbox", { name: "Check for new chapters when the app opens" })).toBeChecked();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("saves the default book language", async () => {
    setup();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Book language" }), "en");
    expect(m.save).toHaveBeenCalledWith({ defaultBookLanguage: "en" });
  });

  it("saves the trimmed author on blur only when it changed", async () => {
    setup();
    const author = await screen.findByRole("textbox", { name: "Author" });
    await userEvent.click(author);
    await userEvent.tab();
    expect(m.save).not.toHaveBeenCalled();
    await userEvent.type(author, "  Jane  ");
    await userEvent.tab();
    expect(m.save).toHaveBeenCalledWith({ defaultAuthor: "Jane" });
    expect(author).toHaveValue("Jane");
  });

  it("Enter in the author box commits it", async () => {
    setup();
    await userEvent.type(await screen.findByRole("textbox", { name: "Author" }), "Bob{Enter}");
    expect(m.save).toHaveBeenCalledWith({ defaultAuthor: "Bob" });
  });

  it("shows a save failure", async () => {
    m.save.mockRejectedValue(new Error("read-only db"));
    setup();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Check for new chapters when the app opens" }));
    expect(await screen.findByText("read-only db")).toBeInTheDocument();
  });

  it("passes AI section callbacks through (saved flash, error)", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "ai-saved" }));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ai-error" }));
    expect(screen.getByText("ai broke")).toBeInTheDocument();
  });
});

describe("SettingsOverlay appearance", () => {
  it("picks a theme, marking the current one", async () => {
    const props = setup();
    await screen.findByText("Appearance");
    expect(screen.getByRole("button", { name: /Light/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: /Dark/ }));
    expect(props.onTheme).toHaveBeenCalledWith("dark");
  });

  it("switches the interface language and remembers it", async () => {
    setup();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Interface language" }), "vi");
    expect(localStorage.getItem("lang")).toBe("vi");
    expect(await screen.findByRole("heading", { name: "Giao diện" })).toBeInTheDocument();
  });
});

describe("SettingsOverlay private mode", () => {
  it("explains how to set a code when none exists", async () => {
    setup();
    expect(await screen.findByText("No code has been set")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change code" })).toBeNull();
  });

  describe("with a code", () => {
    beforeEach(() => {
      m.fetchSettings.mockResolvedValue({ settings, app: { ...app, privateConfigured: true } });
    });

    const fill = async (label: string, digits: string) => {
      const first = within(screen.getByRole("group", { name: label })).getAllByLabelText(/Digit/)[0];
      await userEvent.click(first);
      await userEvent.keyboard(digits);
    };

    it("changes the code after entering current, new and repeat", async () => {
      m.changeCode.mockResolvedValue();
      setup();
      await userEvent.click(await screen.findByRole("button", { name: "Change code" }));
      const submit = () => screen.getAllByRole("button", { name: "Change code" }).at(-1)!;
      expect(submit()).toBeDisabled();
      await fill("Current code", "111111");
      await fill("New code", "222222");
      await fill("Repeat the code", "222222");
      await userEvent.click(submit());
      expect(m.changeCode).toHaveBeenCalledWith("111111", "222222");
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Change code" })).toHaveLength(1));
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("refuses mismatching new codes", async () => {
      setup();
      await userEvent.click(await screen.findByRole("button", { name: "Change code" }));
      await fill("Current code", "111111");
      await fill("New code", "222222");
      await fill("Repeat the code", "333333");
      await userEvent.click(screen.getAllByRole("button", { name: "Change code" }).at(-1)!);
      expect(screen.getByText("The two codes do not match")).toBeInTheDocument();
      expect(m.changeCode).not.toHaveBeenCalled();
    });

    it("shows a wrong-code error and clears the inputs", async () => {
      m.changeCode.mockRejectedValue(new Error("Wrong code"));
      setup();
      await userEvent.click(await screen.findByRole("button", { name: "Change code" }));
      await fill("Current code", "111111");
      await fill("New code", "222222");
      await fill("Repeat the code", "222222");
      await userEvent.click(screen.getAllByRole("button", { name: "Change code" }).at(-1)!);
      expect(await screen.findByText("Wrong code")).toBeInTheDocument();
      expect(within(screen.getByRole("group", { name: "Current code" })).getAllByLabelText(/Digit/)[0]).toHaveValue("");
    });

    it("Escape closes the code form first, and the page on the second press", async () => {
      const props = setup();
      await userEvent.click(await screen.findByRole("button", { name: "Change code" }));
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("group", { name: "Current code" })).toBeNull();
      expect(props.onClose).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(props.onClose).toHaveBeenCalled();
    });
  });
});

describe("SettingsOverlay site sessions", () => {
  it("offers Import session when none is saved", async () => {
    setup();
    await screen.findByText("Site sessions");
    await waitFor(() => expect(m.session).toHaveBeenCalledWith("asianfanfics"));
    expect(screen.getAllByRole("button", { name: "Import session" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("shows account, expiry and saved time for a live session and can remove it", async () => {
    m.session.mockImplementation(async (slug) =>
      slug === "asianfanfics"
        ? {
            configured: true,
            username: "bob",
            savedAt: new Date(Date.now() - 3600_000).toISOString(),
            expiresAt: new Date(Date.now() + 30 * 60_000 + 5000).toISOString(),
          }
        : { configured: false }
    );
    setup();
    expect(await screen.findByRole("link", { name: "bob" })).toHaveAttribute(
      "href",
      "https://www.asianfanfics.com/profile/u/bob"
    );
    expect(screen.getByText(/Expires in about 30 min\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace session" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(m.removeSession).toHaveBeenCalledWith("asianfanfics");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove" })).toBeNull());
  });

  it("flags an expired session and offers Import again", async () => {
    m.session.mockImplementation(async (slug) =>
      slug === "asianfanfics"
        ? { configured: true, expiresAt: new Date(Date.now() - 60_000).toISOString() }
        : { configured: false }
    );
    setup();
    expect(await screen.findByText("Session has expired — import a fresh one.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace session" })).toBeNull();
  });

  it("reports a failed removal", async () => {
    m.session.mockResolvedValue({ configured: true });
    m.removeSession.mockRejectedValue(new Error("cannot delete"));
    setup();
    await userEvent.click((await screen.findAllByRole("button", { name: "Remove" }))[0]);
    expect(await screen.findByText("cannot delete")).toBeInTheDocument();
  });

  it("opens the import dialog, saves, closes and reloads the status", async () => {
    m.importSession.mockResolvedValue({ cookieCount: 1 });
    setup();
    await waitFor(() => expect(m.session).toHaveBeenCalledTimes(4));
    const before = m.session.mock.calls.length;
    await userEvent.click(screen.getAllByRole("button", { name: "Import session" })[0]);
    await userEvent.type(screen.getByLabelText("cURL from your browser"), "curl x");
    await userEvent.click(screen.getByRole("button", { name: "Save session" }));
    expect(m.importSession).toHaveBeenCalledWith("asianfanfics", "curl x");
    await waitFor(() => expect(screen.queryByLabelText("cURL from your browser")).toBeNull());
    expect(m.session.mock.calls.length).toBe(before + 1);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});
