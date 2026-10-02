// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderEn } from "../../test/renderEn";
import VaultPrompt, { PinInput } from "./VaultPrompt";

afterEach(cleanup);

const box = (label: string, i: number) =>
  screen.getByRole("group", { name: label }).querySelectorAll("input")[i] as HTMLInputElement;

async function typeCode(label: string, digits: string) {
  await userEvent.click(box(label, 0));
  await userEvent.keyboard(digits);
}

describe("VaultPrompt unlock", () => {
  it("starts focused on the first box and submits a full code", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderEn(<VaultPrompt mode="unlock" onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(box("Code", 0)).toHaveFocus();
    const open = screen.getByRole("button", { name: "Open" });
    expect(open).toBeDisabled();
    await userEvent.keyboard("12345");
    expect(open).toBeDisabled();
    await userEvent.keyboard("6");
    expect(open).toBeEnabled();
    await userEvent.click(open);
    expect(onSubmit).toHaveBeenCalledWith("123456");
  });

  it("ignores non-digits", async () => {
    renderEn(<VaultPrompt mode="unlock" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.keyboard("a1b2");
    expect(box("Code", 0)).toHaveValue("1");
    expect(box("Code", 1)).toHaveValue("2");
    expect(box("Code", 2)).toHaveValue("");
  });

  it("fills the row from a pasted code and backspace removes the last digit", async () => {
    renderEn(<VaultPrompt mode="unlock" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.click(box("Code", 0));
    await userEvent.paste("987654");
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
    await userEvent.keyboard("{Backspace}");
    expect(box("Code", 5)).toHaveValue("");
    expect(box("Code", 4)).toHaveValue("5");
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
  });

  it("shows the error, clears the code and puts the caret back on the first box", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Wrong code"));
    renderEn(<VaultPrompt mode="unlock" onSubmit={onSubmit} onCancel={vi.fn()} />);
    await userEvent.keyboard("111111");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong code");
    expect(box("Code", 0)).toHaveValue("");
    await waitFor(() => expect(box("Code", 0)).toHaveFocus());
  });

  it("cancels with the button, Escape and the backdrop", async () => {
    const onCancel = vi.fn();
    renderEn(<VaultPrompt mode="unlock" onSubmit={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(3);
  });
});

describe("VaultPrompt setup", () => {
  it("asks for the code twice and moves to the repeat row", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderEn(<VaultPrompt mode="setup" onSubmit={onSubmit} onCancel={vi.fn()} />);
    await userEvent.keyboard("123456");
    expect(box("Repeat the code", 0)).toHaveFocus();
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();
    await userEvent.keyboard("123456");
    await userEvent.click(create);
    expect(onSubmit).toHaveBeenCalledWith("123456");
  });

  it("refuses mismatched codes without calling onSubmit", async () => {
    const onSubmit = vi.fn();
    renderEn(<VaultPrompt mode="setup" onSubmit={onSubmit} onCancel={vi.fn()} />);
    await userEvent.keyboard("123456");
    await userEvent.keyboard("654321");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The two codes do not match");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box("Repeat the code", 0)).toHaveValue("");
    expect(box("New code", 0)).toHaveValue("1");
  });
});

describe("PinInput", () => {
  it("arrow keys move between boxes and clicking past the end lands on the first empty box", async () => {
    function Harness() {
      const [v, setV] = useState("12");
      return <PinInput id="p" label="Pin" value={v} onChange={setV} t={(k) => k} />;
    }
    renderEn(<Harness />);
    await userEvent.click(box("Pin", 1));
    await userEvent.keyboard("{ArrowRight}");
    expect(box("Pin", 2)).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(box("Pin", 0)).toHaveFocus();
    await userEvent.click(box("Pin", 5));
    expect(box("Pin", 2)).toHaveFocus();
  });

  it("calls onComplete when the sixth digit lands", async () => {
    const onComplete = vi.fn();
    renderEn(<PinInput id="p" label="Pin" value="12345" onChange={vi.fn()} onComplete={onComplete} t={(k) => k} />);
    await userEvent.click(box("Pin", 5));
    await userEvent.keyboard("6");
    expect(onComplete).toHaveBeenCalled();
  });
});
