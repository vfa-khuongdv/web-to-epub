import { describe, expect, it, vi } from "vitest";
import { codeCommands, fileCommands } from "./commands";

const t = (key: string) => key;
const actions = () => ({
  nextFile: vi.fn(),
  previousFile: vi.fn(),
  togglePanel: vi.fn(),
  toggleSidebar: vi.fn(),
  quickOpen: vi.fn(),
  closeEditor: vi.fn(),
});

describe("codeCommands", () => {
  it("offers next/previous only when there is a file to go to", () => {
    const none = codeCommands(t, actions(), { hasFile: false, hasNext: false, hasPrevious: false }, false);
    expect(none.map((command) => command.label)).toEqual(["Go to file…", "Toggle panel", "Toggle sidebar"]);

    const all = codeCommands(t, actions(), { hasFile: true, hasNext: true, hasPrevious: true }, false);
    expect(all.map((command) => command.label)).toEqual([
      "Next file",
      "Previous file",
      "Go to file…",
      "Toggle panel",
      "Toggle sidebar",
      "Close editor",
    ]);
  });

  it("prints shortcuts for the platform", () => {
    const pc = codeCommands(t, actions(), { hasFile: false, hasNext: false, hasPrevious: false }, false);
    const mac = codeCommands(t, actions(), { hasFile: false, hasNext: false, hasPrevious: false }, true);
    expect(pc.find((command) => command.id === "code-panel")?.hint).toBe("Ctrl+J");
    expect(mac.find((command) => command.id === "code-panel")?.hint).toBe("⌘J");
  });

  it("runs the action it names", () => {
    const handlers = actions();
    const list = codeCommands(t, handlers, { hasFile: true, hasNext: true, hasPrevious: false }, false);
    list.find((command) => command.id === "code-next")?.run();
    list.find((command) => command.id === "code-sidebar")?.run();
    expect(handlers.nextFile).toHaveBeenCalledOnce();
    expect(handlers.toggleSidebar).toHaveBeenCalledOnce();
  });
});

describe("fileCommands", () => {
  const folders = [
    { storyId: "a", folder: "tro-ve", files: [{ order: 1, name: "ch-0001.md" }, { order: 2, name: "ch-0002.md" }] },
    { storyId: "b", folder: "module-02", files: [{ order: 1, name: "part-0001.md" }] },
  ];

  it("lists folders, then files with their folder", () => {
    const open = { folder: vi.fn(), file: vi.fn() };
    const list = fileCommands(folders, open);
    expect(list.map((command) => [command.label, command.hint])).toEqual([
      ["tro-ve/", "workspace"],
      ["module-02/", "workspace"],
      ["ch-0001.md", "tro-ve"],
      ["ch-0002.md", "tro-ve"],
      ["part-0001.md", "module-02"],
    ]);
    list[4].run();
    expect(open.file).toHaveBeenCalledWith("b", 1);
    list[0].run();
    expect(open.folder).toHaveBeenCalledWith("a");
  });

  it("stops at the limit", () => {
    expect(fileCommands(folders, { folder: vi.fn(), file: vi.fn() }, 3)).toHaveLength(3);
  });
});
