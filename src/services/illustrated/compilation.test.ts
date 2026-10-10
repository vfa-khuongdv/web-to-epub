import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseBible } from "./bible";
import { pickSlides, renderIllustratedCompilation, slideshowArgs, slideshowList } from "./compilation";
import { TimedScene } from "./types";

const scene = (from: number, to: number, cast: number): TimedScene => ({
  fromPart: 0,
  toPart: 0,
  from,
  to,
  place: "field",
  time: "day",
  cast: Array.from({ length: cast }, () => ({ id: "a", spot: "center" as const, expression: "smile" as const })),
  captions: [{ text: "x", from: 0, to: to - from }],
});

describe("pickSlides", () => {
  it("gives a short chapter one slide and a long one a slide per half", () => {
    expect(pickSlides(1, 60, [scene(0, 60, 1)])).toHaveLength(1);
    const slides = pickSlides(2, 600, [scene(0, 300, 1), scene(300, 600, 1)]);
    expect(slides.map((slide) => slide.seconds)).toEqual([300, 300]);
    expect(slides[0].scene.from).toBe(0);
    expect(slides[1].scene.from).toBe(300);
  });

  it("prefers a scene with a character over empty scenery", () => {
    const slides = pickSlides(1, 100, [scene(0, 50, 0), scene(50, 100, 2)]);
    expect(slides[0].scene.cast).toHaveLength(2);
  });

  it("has no slide for a chapter without scenes", () => {
    expect(pickSlides(1, 60, [])).toEqual([]);
  });
});

describe("slideshow files", () => {
  it("lists each picture with its duration and repeats the last one", () => {
    expect(slideshowList([{ file: "/a b/1.png", seconds: 30 }, { file: "/a b/2.png", seconds: 12.5 }])).toBe(
      "file '/a b/1.png'\nduration 30.000\nfile '/a b/2.png'\nduration 12.500\nfile '/a b/2.png'\n"
    );
  });

  it("joins the list with the narration, with or without music", () => {
    const base = { listFile: "l", audioPath: "a", outPath: "o", seconds: 100 };
    expect(slideshowArgs(base).join(" ")).not.toContain("amix");
    const mixed = slideshowArgs({ ...base, musicPath: "m", musicVolume: 0.3 }).join(" ");
    expect(mixed).toContain("amix=inputs=2");
    expect(mixed).toContain("volume=0.3");
    expect(mixed).toContain("-f concat");
  });
});

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

describe("renderIllustratedCompilation", () => {
  it("plans every chapter once, snapshots the slides in batches and joins them", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ill-comp-"));
    const out = path.join(dataDir, "out", "c.mp4");
    let agentCalls = 0;
    const agent = {
      complete: async () => (
        agentCalls++,
        JSON.stringify({ scenes: [{ from: 0, to: 0, place: "sea", time: "dusk", cast: [{ id: "a", spot: "center", expression: "smile" }] }] })
      ),
    };
    const chapters = [1, 2, 3].map((order) => ({
      order,
      title: `Chương ${order}`,
      blocks: [{ type: "paragraph", text: `Đoạn của chương ${order}.` }] as never,
      seconds: 200,
    }));
    const batches: number[] = [];
    let listing = "";
    const progress: number[] = [];
    await renderIllustratedCompilation({
      dataDir,
      storyId: "s",
      storyTitle: "T",
      bible,
      chapters,
      agent,
      command: "ffmpeg",
      audioPath: "/tmp/all.mp3",
      seconds: 600,
      outPath: out,
      onProgress: (fraction) => progress.push(fraction),
      snapshot: async ({ projectDir, outDir, count }) => {
        batches.push(count);
        const html = await fs.readFile(path.join(projectDir, "compositions", "scene-0.html"), "utf8");
        expect(html).toContain("Chapter 1");
        expect(html).not.toContain('class="cap');
        return Promise.all(
          Array.from({ length: count }, async (_, index) => {
            const file = path.join(outDir, `frame-${index}.png`);
            await fs.writeFile(file, "png");
            return file;
          })
        );
      },
      run: async (_command, args) => {
        listing = await fs.readFile(args[args.indexOf("-i") + 1], "utf8");
        await fs.writeFile(args[args.length - 1], "video");
      },
    });
    expect(agentCalls).toBe(3);
    expect(batches).toEqual([6]);
    expect((listing.match(/^file /gm) ?? []).length).toBe(7);
    expect(await fs.readFile(out, "utf8")).toBe("video");
    expect(progress[progress.length - 1]).toBeGreaterThan(0.69);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));

    // A second run reuses the saved scenes: no agent.
    await renderIllustratedCompilation({
      dataDir, storyId: "s", storyTitle: "T", bible, chapters, agent: undefined, command: "ffmpeg", audioPath: "a", seconds: 600, outPath: out,
      snapshot: async ({ outDir, count }) => Array.from({ length: count }, (_, index) => path.join(outDir, `f${index}.png`)),
      run: async (_c, args) => void (await fs.writeFile(args[args.length - 1], "video")),
    });
    expect(agentCalls).toBe(3);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("stops between chapters when aborted", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ill-comp-"));
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderIllustratedCompilation({
        dataDir, storyId: "s", storyTitle: "T", bible, command: "ffmpeg", audioPath: "a", seconds: 10, outPath: path.join(dataDir, "o.mp4"),
        chapters: [{ order: 1, title: "C", blocks: [{ type: "paragraph", text: "x" }] as never, seconds: 10 }],
        signal: controller.signal,
      })
    ).rejects.toThrow();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
});
