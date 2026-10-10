// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, TtsStatus } from "../../types";
import { renderEn } from "../../test/renderEn";

vi.mock("../../lib/api", () => ({
  deleteTtsVoice: vi.fn(),
  fetchTtsStatus: vi.fn(),
  fetchTtsVoices: vi.fn(),
  installTts: vi.fn(),
  previewTts: vi.fn(),
  uninstallTts: vi.fn(),
  uploadTtsVoice: vi.fn(),
}));
import { deleteTtsVoice, fetchTtsStatus, fetchTtsVoices, installTts, previewTts, uninstallTts, uploadTtsVoice } from "../../lib/api";
import NarrationSettings, { engineOf } from "./NarrationSettings";

const m = {
  status: vi.mocked(fetchTtsStatus),
  voices: vi.mocked(fetchTtsVoices),
  install: vi.mocked(installTts),
  uninstall: vi.mocked(uninstallTts),
  preview: vi.mocked(previewTts),
  upload: vi.mocked(uploadTtsVoice),
  remove: vi.mocked(deleteTtsVoice),
};

const Row = ({ label, hint, control }: { label: string; hint?: ReactNode; control: ReactNode }) => (
  <div role="group" aria-label={label}>
    <div data-testid={`hint-${label}`}>{hint}</div>
    {control}
  </div>
);

const settingsOf = (over: Partial<AppSettings> = {}) =>
  ({ ttsVariant: "turbo", ttsVoice: "", narrationIntro: true, narrationIntroText: "", ...over }) as AppSettings;

const statusOf = (over: Partial<TtsStatus> = {}): TtsStatus => ({
  engine: "vieneu",
  supported: true,
  state: "installed",
  version: "1.2.3",
  running: false,
  busy: false,
  diskBytes: 2048,
  ...over,
});

function setup(settings = settingsOf()) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderEn(<NarrationSettings settings={settings} onSave={onSave} Row={Row} />);
  return onSave;
}

beforeEach(() => {
  m.status.mockReset().mockResolvedValue(statusOf());
  m.voices.mockReset().mockResolvedValue([
    { id: "v1", label: "Lan" },
    { id: "custom:9", label: "Mine", custom: true },
  ]);
  m.install.mockReset();
  m.uninstall.mockReset();
  m.preview.mockReset();
  m.upload.mockReset();
  m.remove.mockReset().mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("engineOf", () => {
  it("maps variants to engines", () => {
    expect(engineOf("omnivoice")).toBe("omnivoice");
    expect(engineOf("turbo")).toBe("vieneu");
    expect(engineOf("nano")).toBe("vieneu");
  });
});

describe("NarrationSettings engine state", () => {
  it("checks, then reports the installed engine with version and size", async () => {
    setup();
    expect(screen.getByText("Checking narration…")).toBeInTheDocument();
    expect(await screen.findByText("VieNeu-TTS 1.2.3, running on this machine. 2.0 KB on disk.")).toBeInTheDocument();
    expect(m.status).toHaveBeenCalledWith(true, "vieneu");
  });

  it("shows a status error", async () => {
    m.status.mockRejectedValue(new Error("no server"));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("no server");
  });

  it("explains an unsupported platform per engine", async () => {
    m.status.mockResolvedValue(statusOf({ supported: false }));
    setup();
    expect(await screen.findByText("Narration is not supported on this platform.")).toBeInTheDocument();
    cleanup();
    m.status.mockResolvedValue(statusOf({ supported: false, engine: "omnivoice" }));
    setup(settingsOf({ ttsVariant: "omnivoice" }));
    expect(await screen.findByText(/needs a Mac with Apple Silicon/)).toBeInTheDocument();
  });

  it("installs and shows the new status", async () => {
    m.status.mockResolvedValue(statusOf({ state: "not-installed" }));
    m.install.mockResolvedValue(statusOf({ state: "installing", phase: "python" }));
    vi.spyOn(globalThis, "setInterval").mockReturnValue(0 as never);
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Install" }));
    expect(m.install).toHaveBeenCalledWith("turbo");
    expect(await screen.findByRole("status")).toHaveTextContent("Setting up Python…");
  });

  it("offers Try again with the message after a failed install", async () => {
    m.status.mockResolvedValue(statusOf({ state: "error", error: "no space" }));
    setup();
    expect(await screen.findByText("Install failed: no space")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("polls while installing and refreshes when it lands", async () => {
    m.status.mockResolvedValueOnce(statusOf({ state: "installing", phase: "uv", downloaded: 50, total: 100 }));
    m.status.mockResolvedValue(statusOf());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    expect(await screen.findByRole("progressbar", { name: "Installing narration" })).toHaveAttribute("aria-valuenow", "50");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(await screen.findByRole("button", { name: "Uninstall" })).toBeInTheDocument();
    expect(m.status).toHaveBeenCalledWith(false, "vieneu");
  });

  it("uninstalls only after confirmation", async () => {
    m.uninstall.mockResolvedValue(statusOf({ state: "not-installed" }));
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    setup();
    const btn = await screen.findByRole("button", { name: "Uninstall" });
    await userEvent.click(btn);
    expect(m.uninstall).not.toHaveBeenCalled();
    await userEvent.click(btn);
    expect(m.uninstall).toHaveBeenCalledWith("vieneu");
    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
  });
});

describe("NarrationSettings engine and model choice", () => {
  it("switching engine saves the variant and keeps only a custom voice", async () => {
    const onSave = setup(settingsOf({ ttsVoice: "v1" }));
    await screen.findByRole("button", { name: "Uninstall" });
    await userEvent.click(screen.getByRole("button", { name: "OmniVoice" }));
    expect(onSave).toHaveBeenCalledWith({ ttsVariant: "omnivoice", ttsVoice: "" });
    cleanup();
    const second = setup(settingsOf({ ttsVoice: "custom:9" }));
    await screen.findByRole("button", { name: "Uninstall" });
    await userEvent.click(screen.getByRole("button", { name: "OmniVoice" }));
    expect(second).toHaveBeenCalledWith({ ttsVariant: "omnivoice", ttsVoice: "custom:9" });
  });

  it("does not save when the current engine is clicked; model tabs switch turbo/nano", async () => {
    const onSave = setup();
    await screen.findByRole("button", { name: "Uninstall" });
    await userEvent.click(screen.getByRole("button", { name: "VieNeu-TTS" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Quality" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: "Fast" }));
    expect(onSave).toHaveBeenCalledWith({ ttsVariant: "nano", ttsVoice: "" });
  });

  it("hides the model row for OmniVoice and lists only its voices", async () => {
    m.status.mockResolvedValue(statusOf({ engine: "omnivoice" }));
    setup(settingsOf({ ttsVariant: "omnivoice" }));
    await screen.findByRole("radiogroup", { name: "Voice" });
    expect(screen.queryByRole("group", { name: "Model" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Model default" })).toBeNull();
    expect(m.voices).toHaveBeenCalledWith("omnivoice");
  });
});

describe("NarrationSettings voices", () => {
  it("lists voices with a model default, marks the selected, and saves a pick", async () => {
    const onSave = setup(settingsOf({ ttsVoice: "v1" }));
    expect(await screen.findByRole("radio", { name: "Lan" })).toBeChecked();
    expect(screen.getByText("Your voice")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Model default" }));
    expect(onSave).toHaveBeenCalledWith({ ttsVoice: "" });
  });

  it("previews a voice, and stops it on a second click", async () => {
    m.preview.mockResolvedValue(new Blob(["x"]));
    const pause = vi.fn();
    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "Audio",
      class {
        pause = pause;
        play = play;
        onended: (() => void) | null = null;
      }
    );
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    setup();
    const btn = await screen.findByRole("button", { name: "Preview “Lan”" });
    await userEvent.click(btn);
    expect(m.preview).toHaveBeenCalledWith("turbo", "v1");
    await waitFor(() => expect(play).toHaveBeenCalled());
    await userEvent.click(btn);
    expect(pause).toHaveBeenCalled();
    expect(m.preview).toHaveBeenCalledTimes(1);
  });

  it("shows a preview failure", async () => {
    m.preview.mockRejectedValue(new Error("engine busy"));
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Preview “Lan”" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("engine busy");
  });

  it("uploads a clip with a name and transcript, then selects it", async () => {
    m.upload.mockResolvedValue({ id: "custom:new", label: "Clip", custom: true });
    const onSave = setup();
    await screen.findByRole("radiogroup", { name: "Voice" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "Clip.mp3", { type: "audio/mpeg" });
    await userEvent.upload(input, file);
    expect(screen.getByLabelText("Name for this voice")).toHaveValue("Clip");
    await userEvent.type(screen.getByLabelText("What is said in the clip"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(m.upload).toHaveBeenCalledWith("Clip", file, "hello");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ ttsVoice: "custom:new" }));
    expect(await screen.findByRole("radio", { name: /Clip/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name for this voice")).toBeNull();
  });

  it("will not upload without a name, and can cancel", async () => {
    setup();
    await screen.findByRole("radiogroup", { name: "Voice" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "Clip.mp3", { type: "audio/mpeg" }));
    await userEvent.clear(screen.getByLabelText("Name for this voice"));
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Name for this voice")).toBeNull();
  });

  it("rejects an oversized clip before showing the name form", async () => {
    setup();
    await screen.findByRole("radiogroup", { name: "Voice" });
    const big = new File(["x"], "big.mp3", { type: "audio/mpeg" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [big] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("too large");
    expect(screen.queryByLabelText("Name for this voice")).toBeNull();
  });

  it("removes a custom voice after confirmation and resets the setting if it was selected", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const onSave = setup(settingsOf({ ttsVoice: "custom:9" }));
    const row = (await screen.findByRole("radio", { name: /Mine/ })).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Remove this voice" }));
    expect(m.remove).toHaveBeenCalledWith("custom:9");
    await waitFor(() => expect(screen.queryByRole("radio", { name: /Mine/ })).toBeNull());
    expect(onSave).toHaveBeenCalledWith({ ttsVoice: "" });
  });

  it("keeps the voice when removal is declined", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Remove this voice" }));
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("shows a hint for OmniVoice with no voice picked", async () => {
    m.status.mockResolvedValue(statusOf({ engine: "omnivoice" }));
    setup(settingsOf({ ttsVariant: "omnivoice" }));
    expect(await screen.findByTestId("hint-Voice")).toHaveTextContent("OmniVoice has no default voice");
  });

  it("turns the channel introduction off and on", async () => {
    const onSave = setup(settingsOf({ narrationIntro: true }));
    const box = await screen.findByRole("checkbox", { name: "Read a channel introduction before chapter 1" });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(onSave).toHaveBeenCalledWith({ narrationIntro: false });
  });

  it("saves the introduction sentence when the field loses focus, only if it changed", async () => {
    const onSave = setup(settingsOf({ narrationIntroText: "Cũ" }));
    const field = await screen.findByRole("textbox", { name: "Introduction sentence" });
    expect(field).toHaveValue("Cũ");
    await userEvent.click(field);
    await userEvent.tab();
    expect(onSave).not.toHaveBeenCalledWith(expect.objectContaining({ narrationIntroText: expect.anything() }));
    await userEvent.clear(field);
    await userEvent.type(field, "  Kênh {{channel} mời nghe {{title}.  ");
    await userEvent.tab();
    expect(onSave).toHaveBeenCalledWith({ narrationIntroText: "Kênh {channel} mời nghe {title}." });
  });

  it("hides the sentence field while the introduction is off", async () => {
    setup(settingsOf({ narrationIntro: false }));
    await screen.findByRole("checkbox", { name: "Read a channel introduction before chapter 1" });
    expect(screen.queryByRole("textbox", { name: "Introduction sentence" })).not.toBeInTheDocument();
  });
});
