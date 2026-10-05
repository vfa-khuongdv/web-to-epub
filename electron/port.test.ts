import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// CommonJS, shared with electron/main.js.
const { choosePort, readSavedPort } = createRequire(import.meta.url)("./port.js") as {
  choosePort: (
    file: string,
    deps?: { isFree?: (port: number) => Promise<boolean>; findFree?: () => Promise<number> }
  ) => Promise<number>;
  readSavedPort: (file: string) => number | null;
};

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "port-test-"));
  file = path.join(dir, "port.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("choosePort", () => {
  it("takes a free port on first launch and remembers it", async () => {
    const port = await choosePort(file, { isFree: async () => true, findFree: async () => 51234 });
    expect(port).toBe(51234);
    expect(readSavedPort(file)).toBe(51234);
  });

  it("reuses the saved port while it is free, so the origin (and its localStorage) stays the same", async () => {
    fs.writeFileSync(file, JSON.stringify({ port: 40001 }));
    const port = await choosePort(file, {
      isFree: async () => true,
      findFree: async () => {
        throw new Error("should not look for another port");
      },
    });
    expect(port).toBe(40001);
  });

  it("runs on another port while the saved one is taken, but keeps the saved one for next time", async () => {
    fs.writeFileSync(file, JSON.stringify({ port: 40001 }));
    const port = await choosePort(file, { isFree: async () => false, findFree: async () => 40002 });
    expect(port).toBe(40002);
    expect(readSavedPort(file)).toBe(40001);
  });

  it("ignores a damaged or out-of-range saved port", async () => {
    for (const content of ["not json", JSON.stringify({ port: 80 }), JSON.stringify({ port: "4000" })]) {
      fs.writeFileSync(file, content);
      expect(readSavedPort(file)).toBeNull();
      const port = await choosePort(file, { isFree: async () => true, findFree: async () => 45678 });
      expect(port).toBe(45678);
    }
  });
});
