import { describe, expect, it } from "vitest";
import { CompletionEntry, complete } from "./complete";

const COMMANDS = ["cat", "cd", "clear", "less", "ls"];
const FOLDERS: Record<string, CompletionEntry[]> = {
  "": [
    { name: "ch-0001-mo-dau.md", dir: false },
    { name: "ch-0002-gap-lai.md", dir: false },
    { name: "notes", dir: true },
  ],
  "../": [
    { name: "tro-ve", dir: true },
    { name: "tro-lai", dir: true },
    { name: "dau-pha", dir: true },
  ],
};
const list = (dirPart: string) => FOLDERS[dirPart] ?? null;

describe("complete", () => {
  it("completes a command name, adding a space", () => {
    expect(complete("le", { commands: COMMANDS, list })).toEqual({ input: "less ", candidates: [] });
  });

  it("lists the commands sharing what was typed", () => {
    expect(complete("c", { commands: COMMANDS, list })).toEqual({ input: "c", candidates: ["cat", "cd", "clear"] });
    expect(complete("cl", { commands: COMMANDS, list }).input).toBe("clear ");
  });

  it("completes a file with a space and a folder with a slash", () => {
    expect(complete("less ch-0001", { commands: COMMANDS, list }).input).toBe("less ch-0001-mo-dau.md ");
    expect(complete("cd no", { commands: COMMANDS, list }).input).toBe("cd notes/");
    expect(complete("cd ../da", { commands: COMMANDS, list }).input).toBe("cd ../dau-pha/");
  });

  it("fills a shared start, then lists the names", () => {
    expect(complete("less ch", { commands: COMMANDS, list })).toEqual({ input: "less ch-000", candidates: [] });
    expect(complete("less ch-000", { commands: COMMANDS, list })).toEqual({
      input: "less ch-000",
      candidates: ["ch-0001-mo-dau.md", "ch-0002-gap-lai.md"],
    });
    expect(complete("cd ../tro-", { commands: COMMANDS, list }).candidates).toEqual(["tro-ve/", "tro-lai/"]);
  });

  it("matches regardless of case when nothing matches exactly", () => {
    expect(complete("cd NO", { commands: COMMANDS, list }).input).toBe("cd notes/");
  });

  it("adds the slash after ..", () => {
    expect(complete("cd ..", { commands: COMMANDS, list }).input).toBe("cd ../");
  });

  it("leaves the line alone when nothing matches or the folder is unknown", () => {
    expect(complete("less zz", { commands: COMMANDS, list })).toEqual({ input: "less zz", candidates: [] });
    expect(complete("less nowhere/x", { commands: COMMANDS, list })).toEqual({ input: "less nowhere/x", candidates: [] });
  });
});
