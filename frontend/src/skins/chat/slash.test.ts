import { describe, expect, it } from "vitest";
import { draftAction, matchSlash, slashQuery } from "./slash";

const commands = [{ name: "next" }, { name: "prev" }, { name: "threads" }, { name: "find" }, { name: "hide" }];

describe("slash commands", () => {
  it("reads the command word being typed", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/Ne")).toBe("ne");
    expect(slashQuery("/next ")).toBeNull();
    expect(slashQuery("hello")).toBeNull();
    expect(slashQuery(" /next")).toBeNull();
  });

  it("lists commands starting with the query first", () => {
    expect(matchSlash(commands, "").map((command) => command.name)).toEqual(["next", "prev", "threads", "find", "hide"]);
    expect(matchSlash(commands, "n").map((command) => command.name)).toEqual(["next", "find"]);
    expect(matchSlash(commands, "zz")).toEqual([]);
  });

  it("runs an exact name, else the highlighted one, else says it is unknown", () => {
    expect(draftAction("/next", commands, undefined)).toEqual({ kind: "run", command: commands[0] });
    expect(draftAction("/NEXT please", commands, undefined)).toEqual({ kind: "run", command: commands[0] });
    expect(draftAction("/th", commands, commands[2])).toEqual({ kind: "run", command: commands[2] });
    expect(draftAction("/nope", commands, undefined)).toEqual({ kind: "unknown", name: "/nope" });
    expect(draftAction("/th more", commands, commands[2])).toEqual({ kind: "unknown", name: "/th" });
  });

  it("shows plain text as a message and ignores an empty draft", () => {
    expect(draftAction("  xin chào  ", commands, undefined)).toEqual({ kind: "message", text: "xin chào" });
    expect(draftAction("   ", commands, undefined)).toEqual({ kind: "none" });
  });
});
