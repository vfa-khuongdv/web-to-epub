import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { renderIllustratedChapter } from "./chapter";
import { muxArgs } from "./render";
import { parseBible } from "./bible";

const face = '<g><circle cx="-22" cy="-6" r="7" fill="#222"/></g>';
const bible = parseBible(
  JSON.stringify({
    style: "flat",
    characters: [
      {
        id: "a",
        name: "A",
        description: "d",
        headY: -380,
        body: '<g><rect x="-40" y="-300" width="80" height="300" fill="#2f8f5a"/></g>',
        faces: { neutral: face, smile: face, sad: face, surprised: face, laugh: face },
      },
    ],
  })
);

describe("muxArgs", () => {
  it("copies the picture and mixes music under the narration when there is music", () => {
    const args = muxArgs({ videoPath: "v", audioPath: "a", outPath: "o", seconds: 60, musicPath: "m", musicVolume: 0.2 });
    expect(args).toContain("copy");
    expect(args.join(" ")).toContain("amix=inputs=2");
    expect(args.join(" ")).toContain("volume=0.2");
    expect(muxArgs({ videoPath: "v", audioPath: "a", outPath: "o", seconds: 60 }).join(" ")).not.toContain("amix");
  });
});

describe("renderIllustratedChapter", () => {
  it("plans scenes with the agent, composes a project, renders and muxes, then reuses the plan", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ill-"));
    const out = path.join(dataDir, "out", "1.mp4");
    const composed: string[] = [];
    let agentCalls = 0;
    const agent = {
      complete: async () => (
        agentCalls++,
        JSON.stringify({
          scenes: [
            { from: 0, to: 0, place: "field", time: "day", cast: [{ id: "a", spot: "center", expression: "smile" }] },
            { from: 1, to: 1, place: "indoor", time: "night", cast: [] },
          ],
        })
      ),
    };
    const base = {
      dataDir,
      storyId: "s",
      storyTitle: "Truyện <A>",
      order: 1,
      chapterTitle: "Chương 1",
      blocks: [
        { type: "paragraph", text: "Câu một." },
        { type: "paragraph", text: "Câu hai." },
      ] as never,
      bible,
      command: "ffmpeg",
      audioPath: "/tmp/a.mp3",
      seconds: 10,
      outPath: out,
      renderVideo: async (r: { projectDir: string; outPath: string }) => {
        composed.push(await fs.readFile(path.join(r.projectDir, "compositions", "scene-0.html"), "utf8"));
        await fs.writeFile(r.outPath, "video");
      },
      run: async (_c: string, args: string[]) => {
        await fs.writeFile(args[args.length - 1], "muxed");
      },
    };
    await renderIllustratedChapter({ ...base, agent });
    expect(agentCalls).toBe(1);
    expect(await fs.readFile(out, "utf8")).toBe("muxed");
    expect(composed[0]).toContain("Câu một.");
    expect(composed[0]).toContain("#2f8f5a");
    expect(composed[0]).not.toContain("<script>alert");

    // The second run needs no agent: the storyboard was saved.
    await renderIllustratedChapter({ ...base, agent: undefined });
    expect(agentCalls).toBe(1);

    // A different story title is escaped in the title card, and a chapter without text is refused.
    await expect(renderIllustratedChapter({ ...base, blocks: [], agent })).rejects.toThrow();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("counts the channel introduction as the first narrated part, so captions and timings line up", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ill-"));
    const prompts: string[] = [];
    const agent = {
      complete: async (prompt: string) => (
        prompts.push(prompt),
        JSON.stringify({ scenes: [{ from: 0, to: 1, place: "field", time: "day", cast: [] }] })
      ),
    };
    let scene = "";
    await renderIllustratedChapter({
      dataDir,
      storyId: "s",
      storyTitle: "T",
      order: 1,
      chapterTitle: "C",
      blocks: [{ type: "paragraph", text: "Câu một." }] as never,
      bible,
      agent,
      intro: "Chào mừng đến kênh.",
      command: "ffmpeg",
      audioPath: "a",
      seconds: 10,
      // One timing per narrated part: the sentence, then the paragraph.
      timings: [[0, 3], [3.5, 9]],
      outPath: path.join(dataDir, "o.mp4"),
      renderVideo: async (r: { projectDir: string; outPath: string }) => {
        scene = await fs.readFile(path.join(r.projectDir, "compositions", "scene-0.html"), "utf8");
        await fs.writeFile(r.outPath, "v");
      },
      run: async (_c: string, args: string[]) => void (await fs.writeFile(args[args.length - 1], "m")),
    });
    expect(prompts[0]).toContain("[0] (0s) Chào mừng đến kênh.");
    expect(prompts[0]).toContain("[1] (4s) Câu một.");
    expect(scene).toContain("Chào mừng đến kênh.");
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("refuses to plan a chapter without an agent when nothing was saved", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ill-"));
    await expect(
      renderIllustratedChapter({
        dataDir, storyId: "s", storyTitle: "T", order: 2, chapterTitle: "C",
        blocks: [{ type: "paragraph", text: "x" }] as never, bible, command: "ffmpeg", audioPath: "a", seconds: 5, outPath: path.join(dataDir, "o.mp4"),
      })
    ).rejects.toThrow(/agent/i);
    await fs.rm(dataDir, { recursive: true, force: true });
  });
});
