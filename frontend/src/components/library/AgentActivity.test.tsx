// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderEn } from "../../test/renderEn";
import type { AgentActivityEvent } from "../../lib/format/agentActivity";
import { AgentActivityButton, AgentActivityDialog } from "./AgentActivity";

afterEach(cleanup);

const ev = (id: number, over: Partial<AgentActivityEvent>): AgentActivityEvent => ({ id, at: 0, kind: "ask", host: "a.test", fn: "toc", agent: "opencode", attempt: 1, of: 3, ...over });

describe("AgentActivityButton", () => {
  it("shows nothing before the agent has done anything", () => {
    const { container } = renderEn(<AgentActivityButton events={[]} busy={false} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says the agent is working, then offers the log", async () => {
    const onOpen = vi.fn();
    const { rerender } = renderEn(<AgentActivityButton events={[ev(1, {})]} busy onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /Agent working…/ }));
    expect(onOpen).toHaveBeenCalled();
    rerender(<AgentActivityButton events={[ev(1, { kind: "saved", count: 3 })]} busy={false} onOpen={onOpen} />);
    expect(screen.getByRole("button", { name: /Agent log/ })).toBeInTheDocument();
  });
});

describe("AgentActivityDialog", () => {
  it("lists each step as a sentence, marking failures, and closes on Escape", async () => {
    const onClose = vi.fn();
    renderEn(
      <AgentActivityDialog
        busy={false}
        onClose={onClose}
        events={[ev(1, {}), ev(2, { kind: "retry", reason: "no chapters" }), ev(3, { kind: "saved", count: 74 })]}
      />
    );
    const log = screen.getByRole("log");
    expect(log).toHaveTextContent("Asking opencode to write the code that reads a.test's chapter list (try 1/3)");
    expect(screen.getByText(/That code did not work: no chapters/)).toHaveClass("text-error");
    expect(log).toHaveTextContent("it found 74 chapters");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("says so when nothing is logged", () => {
    renderEn(<AgentActivityDialog busy events={[]} onClose={vi.fn()} />);
    expect(screen.getByText("Nothing logged yet.")).toBeInTheDocument();
  });
});
