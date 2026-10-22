import { describe, expect, it } from "vitest";
import { parseLine, readOptions } from "./shellParse";

describe("parseLine", () => {
  it("splits words on any run of spaces", () => {
    expect(parseLine("  ls   -l  dir ")).toEqual({ name: "ls", args: ["-l", "dir"], background: false, unclosed: null });
    expect(parseLine("")).toEqual({ name: "", args: [], background: false, unclosed: null });
  });

  it("keeps quoted spaces and backslash escapes", () => {
    expect(parseLine(`cat "a b.md" 'c d' e\\ f`).args).toEqual(["a b.md", "c d", "e f"]);
    expect(parseLine(`echo ""`).args).toEqual([""]);
  });

  it("reads a trailing & as a background job", () => {
    expect(parseLine("sync &")).toMatchObject({ name: "sync", args: [], background: true });
    expect(parseLine("sync&")).toMatchObject({ name: "sync", background: true });
  });

  it("reports a quote left open", () => {
    expect(parseLine(`echo "abc`).unclosed).toBe('"');
    expect(parseLine(`echo 'abc`).unclosed).toBe("'");
  });
});

describe("readOptions", () => {
  it("reads combined flags and operands", () => {
    const options = readOptions(["-la", "dir", "-h"], "1ahlrt");
    expect([...options.flags].sort()).toEqual(["a", "h", "l"]);
    expect(options.operands).toEqual(["dir"]);
    expect(options.invalid).toBeNull();
  });

  it("reads a value in every form head and tail take", () => {
    expect(readOptions(["-n", "20", "f"], "", "n").values.n).toBe("20");
    expect(readOptions(["-n5", "f"], "", "n").values.n).toBe("5");
    expect(readOptions(["-15", "f"], "", "n").values.n).toBe("15");
    expect(readOptions(["-n"], "", "n").invalid).toBe("n");
  });

  it("names the first unknown flag and stops at --", () => {
    expect(readOptions(["-lz"], "l").invalid).toBe("z");
    expect(readOptions(["--", "-l"], "l").operands).toEqual(["-l"]);
  });
});
