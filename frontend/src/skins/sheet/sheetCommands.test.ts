import { describe, expect, it, vi } from "vitest";
import { SheetCommandInput, sheetCommands } from "./sheetCommands";

const t = (key: string) => key;

function input(extra: Partial<SheetCommandInput> = {}): SheetCommandInput {
  return {
    kind: "library",
    page: 0,
    pages: 1,
    backTo: "Danh_muc",
    activeName: "Danh_muc",
    stepChapter: vi.fn(),
    backToList: vi.fn(),
    turnPage: vi.fn(),
    close: vi.fn(),
    ...extra,
  };
}

const ids = (list: { id: string }[]) => list.map((command) => command.id);

describe("sheetCommands", () => {
  it("offers nothing extra on a short library sheet", () => {
    expect(sheetCommands(input(), t)).toEqual([]);
  });

  it("offers chapter navigation, the way back and closing on a chapter sheet", () => {
    const actions = input({ kind: "chapter", backTo: "tro_ve", activeName: "Ch_0012" });
    const list = sheetCommands(actions, t);
    expect(ids(list)).toEqual(["next-chapter", "previous-chapter", "back-to-list", "close-sheet"]);
    expect(list[2].hint).toBe("tro_ve");
    list[0].run();
    list[1].run();
    expect(actions.stepChapter).toHaveBeenNthCalledWith(1, 1);
    expect(actions.stepChapter).toHaveBeenNthCalledWith(2, -1);
  });

  it("pages a long sheet both ways from a middle page", () => {
    const actions = input({ kind: "story", page: 1, pages: 3 });
    const list = sheetCommands(actions, t);
    expect(ids(list)).toEqual(["back-to-list", "next-page", "previous-page", "close-sheet"]);
    list[1].run();
    list[2].run();
    expect(actions.turnPage).toHaveBeenNthCalledWith(1, 2);
    expect(actions.turnPage).toHaveBeenNthCalledWith(2, 0);
  });
});
