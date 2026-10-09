import fs from "fs/promises";
import os from "os";
import path from "path";
import { AgentModel } from "../agent/agentConfig";
import { t } from "../lang";
import { ContentBlock } from "../../types";
import { chapterParts } from "../tts/chapterText";
import { composeProject } from "./compose";
import { renderProject, RenderProjectInput } from "./render";
import {
  partWindows,
  readStoryboard,
  saveStoryboard,
  splitLongScenes,
  storyboardKey,
  timeScenes,
  writeStoryboard,
} from "./storyboard";
import { Bible } from "./types";

export interface IllustratedChapterInput {
  dataDir: string;
  storyId: string;
  storyTitle: string;
  order: number;
  chapterTitle: string;
  blocks: ContentBlock[];
  bible: Bible;
  // None = reuse a storyboard made before; without one the chapter cannot be planned.
  agent?: AgentModel;
  command: string;
  audioPath: string;
  seconds: number;
  timings?: [number, number][];
  outPath: string;
  musicPath?: string;
  musicVolume?: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  // Test seams, passed to renderProject.
  renderVideo?: RenderProjectInput["renderVideo"];
  run?: RenderProjectInput["run"];
}

export async function renderIllustratedChapter(input: IllustratedChapterInput): Promise<void> {
  const parts = chapterParts(input.chapterTitle, input.blocks);
  if (parts.length === 0) throw new Error(t("Chapter {order} has no text to illustrate", { order: input.order }));
  const windows = partWindows(parts, input.seconds, input.timings);
  const key = storyboardKey(input.bible, parts);
  let scenes = await readStoryboard(input.dataDir, input.storyId, input.order, key);
  if (!scenes) {
    if (!input.agent) throw new Error(t("Illustrated videos need the agent (Settings → Agent crawler) to plan the scenes"));
    scenes = splitLongScenes(
      await writeStoryboard(input.agent, {
        storyTitle: input.storyTitle,
        bible: input.bible,
        parts,
        windows,
        seconds: input.seconds,
        signal: input.signal,
      }),
      windows,
      input.seconds
    );
    await saveStoryboard(input.dataDir, input.storyId, input.order, key, scenes);
  }
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "illustrated-project-"));
  try {
    await composeProject({
      dir: projectDir,
      bible: input.bible,
      scenes: timeScenes(scenes, parts, windows, input.seconds),
      seconds: input.seconds,
      storyTitle: input.storyTitle,
      chapterTitle: input.chapterTitle,
    });
    await renderProject({
      command: input.command,
      projectDir,
      audioPath: input.audioPath,
      outPath: input.outPath,
      seconds: input.seconds,
      musicPath: input.musicPath,
      musicVolume: input.musicVolume,
      signal: input.signal,
      onProgress: input.onProgress,
      renderVideo: input.renderVideo,
      run: input.run,
    });
  } finally {
    await fs.rm(projectDir, { recursive: true, force: true });
  }
}
