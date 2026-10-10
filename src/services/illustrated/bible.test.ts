import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { loadBible, parseBible, removeBible, saveBible, writeBible } from "./bible";

const face = '<g><circle cx="-22" cy="-6" r="7" fill="#222"/></g>';
const character = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: "Nhân vật",
  description: "tóc vàng",
  headY: -380,
  body: '<g><rect x="-40" y="-300" width="80" height="300" fill="#2f8f5a"/></g>',
  faces: { neutral: face, smile: face, sad: face, surprised: face, laugh: face },
  ...extra,
});
const reply = (characters: unknown[]) => JSON.stringify({ style: "flat", characters });

describe("parseBible", () => {
  it("accepts a valid bible", () => {
    const bible = parseBible(reply([character("a"), character("b")]));
    expect(bible.characters.map((c) => c.id)).toEqual(["a", "b"]);
    expect(bible.style).toBe("flat");
  });

  it("finds the JSON inside surrounding text", () => {
    expect(parseBible(`Đây là kết quả:\n${reply([character("a")])}\nXong.`).characters).toHaveLength(1);
  });

  it.each([
    ["no JSON", "xin lỗi"],
    ["no characters", reply([])],
    ["a duplicate id", reply([character("a"), character("a")])],
    ["a bad id", reply([character("Có Dấu")])],
    ["a headY out of range", reply([character("a", { headY: 20 })])],
    ["an unsafe body", reply([character("a", { body: "<g><script/></g>" })])],
    ["a missing face", reply([character("a", { faces: { neutral: face } })])],
    ["too many characters", reply(Array.from({ length: 7 }, (_, i) => character(`c${i}`)))],
  ])("refuses %s", (_name, text) => {
    expect(() => parseBible(text)).toThrow();
  });
});

describe("writeBible", () => {
  it("feeds the problem back and accepts the second answer", async () => {
    const prompts: string[] = [];
    const answers = ["không phải json", reply([character("a")])];
    const agent = {
      complete: async (prompt: string) => {
        prompts.push(prompt);
        return answers.shift() ?? "";
      },
    };
    const bible = await writeBible(agent, { storyTitle: "T", excerpt: "x" });
    expect(bible.characters[0].id).toBe("a");
    expect(prompts[1]).toContain("Lần trước bị từ chối vì: không có JSON");
  });

  it("gives up after three bad answers", async () => {
    let calls = 0;
    const agent = { complete: async () => (calls++, "no") };
    await expect(writeBible(agent, { storyTitle: "T", excerpt: "x" })).rejects.toThrow();
    expect(calls).toBe(3);
  });
});

describe("bible store", () => {
  it("saves, loads and removes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bible-"));
    expect(await loadBible(dir, "s1")).toBeUndefined();
    await saveBible(dir, "s1", parseBible(reply([character("a")])));
    expect((await loadBible(dir, "s1"))?.characters[0].id).toBe("a");
    await removeBible(dir, "s1");
    expect(await loadBible(dir, "s1")).toBeUndefined();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
