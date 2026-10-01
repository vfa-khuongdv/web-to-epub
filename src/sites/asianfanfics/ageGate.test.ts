import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { verifyAge } from "./ageGate";

function fakePage(gates: number) {
  const click = vi.fn().mockResolvedValue(undefined);
  const page = {
    locator: vi.fn(() => ({ count: async () => gates, first: () => ({ click }) })),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
  };
  return { page: page as unknown as Page, click, waitForLoadState: page.waitForLoadState };
}

describe("verifyAge", () => {
  it("clicks the age gate once, then waits for the reload", async () => {
    const { page, click, waitForLoadState } = fakePage(1);
    await verifyAge(page);
    expect(click).toHaveBeenCalledOnce();
    expect(waitForLoadState).toHaveBeenCalledWith("domcontentloaded");
  });

  it("does nothing on a page without the gate", async () => {
    const { page, click, waitForLoadState } = fakePage(0);
    await verifyAge(page);
    expect(click).not.toHaveBeenCalled();
    expect(waitForLoadState).not.toHaveBeenCalled();
  });
});
