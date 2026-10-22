import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { AgentModel } from "../agent/agentConfig";
import { t } from "../lang";
import { Bible, EXPRESSIONS, PLACES, Scene, SceneCast, SPOTS, TIMES, TimedScene } from "./types";

const ATTEMPTS = 3;
const SECONDS_PER_SCENE = 7;
const MAX_SCENES = 80;
const MAX_SCENE_SECONDS = 30;
const MAX_CAST = 3;

// When a chapter has no per-part timings (older audio) the parts share the length by text size.
export function partWindows(parts: string[], seconds: number, timings?: [number, number][]): [number, number][] {
  if (timings && timings.length === parts.length) {
    return timings.map(([from, to]) => [from, Math.max(to, from + 0.2)] as [number, number]);
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0) || 1;
  let at = 0;
  return parts.map((part) => {
    const from = at;
    at += (part.length / total) * seconds;
    return [from, at] as [number, number];
  });
}

export function targetScenes(seconds: number, partCount: number): number {
  return Math.max(1, Math.min(partCount, MAX_SCENES, Math.round(seconds / SECONDS_PER_SCENE)));
}

export function storyboardPrompt(
  storyTitle: string,
  bible: Bible,
  parts: string[],
  windows: [number, number][],
  seconds: number,
  problem?: string
): string {
  const numbered = parts.map((part, index) => {
    const text = part.length > 160 ? `${part.slice(0, 157)}…` : part;
    return `[${index}] (${windows[index][0].toFixed(0)}s) ${text}`;
  });
  return [
    "Bạn là đạo diễn hình ảnh cho video truyện audio. Chia một chương thành các CẢNH liên tiếp để minh hoạ, dùng các nhân vật đã vẽ sẵn.",
    `Chương dài ${seconds.toFixed(0)} giây, gồm ${parts.length} đoạn đọc được đánh số [0]…[${parts.length - 1}]. Chia thành khoảng ${targetScenes(seconds, parts.length)} cảnh.`,
    "Quy tắc:",
    "- Các cảnh phủ KÍN mọi đoạn theo thứ tự: cảnh đầu from=0, mỗi cảnh sau có from = to của cảnh trước + 1, cảnh cuối to=" + (parts.length - 1) + ". Không bỏ sót, không chồng lấn.",
    "- Một cảnh gồm các đoạn liền nhau cùng bối cảnh/tình huống; đổi cảnh khi đổi nơi chốn, thời điểm hoặc người nói.",
    `- place thuộc: ${PLACES.join(", ")}. time thuộc: ${TIMES.join(", ")}. Chọn theo nội dung đoạn, không đổi vô cớ.`,
    `- cast: các nhân vật CÓ MẶT trong cảnh (tối đa ${MAX_CAST}, chỉ dùng id trong danh sách), mỗi người một spot trong ${SPOTS.join("/")} (không trùng spot) và một expression trong ${EXPRESSIONS.join("/")} khớp cảm xúc của cảnh. Cảnh tả phong cảnh/không ai xuất hiện thì cast rỗng.`,
    "",
    "Nhân vật:",
    ...bible.characters.map((character) => `- ${character.id}: ${character.name} — ${character.description}`),
    "",
    "Trả về DUY NHẤT một JSON, không giải thích:",
    '{"scenes":[{"from":0,"to":3,"place":"field","time":"day","cast":[{"id":"…","spot":"left","expression":"smile"}]}]}',
    ...(problem ? ["", `Lần trước bị từ chối vì: ${problem}. Hãy sửa lỗi đó và trả về JSON đầy đủ.`] : []),
    "",
    `Truyện "${storyTitle}":`,
    ...numbered,
  ].join("\n");
}

function fail(message: string): never {
  throw new Error(message);
}

export function parseStoryboard(reply: string, bible: Bible, partCount: number): Scene[] {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) fail("không có JSON");
  let value: { scenes?: unknown };
  try {
    value = JSON.parse(reply.slice(start, end + 1));
  } catch {
    fail("JSON không hợp lệ");
  }
  if (!Array.isArray(value.scenes) || value.scenes.length === 0) fail("thiếu danh sách scenes");
  const ids = new Set(bible.characters.map((character) => character.id));
  let expected = 0;
  const scenes = value.scenes.map((raw: Record<string, unknown>, index: number) => {
    const label = `cảnh ${index + 1}`;
    if (raw.from !== expected) fail(`${label}: from phải là ${expected} (các cảnh phải liền nhau, bắt đầu từ 0)`);
    const to = Number(raw.to);
    if (!Number.isInteger(to) || to < expected || to >= partCount) fail(`${label}: to phải từ ${expected} đến ${partCount - 1}`);
    expected = to + 1;
    if (!(PLACES as readonly string[]).includes(raw.place as string)) fail(`${label}: place không hợp lệ`);
    if (!(TIMES as readonly string[]).includes(raw.time as string)) fail(`${label}: time không hợp lệ`);
    const rawCast = Array.isArray(raw.cast) ? raw.cast : [];
    if (rawCast.length > MAX_CAST) fail(`${label}: tối đa ${MAX_CAST} nhân vật`);
    const spots = new Set<string>();
    const cast: SceneCast[] = rawCast.map((member: Record<string, unknown>) => {
      if (!ids.has(member.id as string)) fail(`${label}: nhân vật "${String(member.id)}" không có trong danh sách`);
      if (!(SPOTS as readonly string[]).includes(member.spot as string) || spots.has(member.spot as string)) {
        fail(`${label}: spot không hợp lệ hoặc trùng`);
      }
      spots.add(member.spot as string);
      if (!(EXPRESSIONS as readonly string[]).includes(member.expression as string)) fail(`${label}: expression không hợp lệ`);
      return { id: member.id as string, spot: member.spot as SceneCast["spot"], expression: member.expression as SceneCast["expression"] };
    });
    return { fromPart: raw.from as number, toPart: to, place: raw.place as Scene["place"], time: raw.time as Scene["time"], cast };
  });
  if (expected !== partCount) fail(`các cảnh mới phủ đến đoạn ${expected - 1}, cần đến ${partCount - 1}`);
  return scenes;
}

// A scene the agent left very long is cut at part boundaries so the picture keeps changing.
export function splitLongScenes(scenes: Scene[], windows: [number, number][], seconds: number): Scene[] {
  const result: Scene[] = [];
  const split = (scene: Scene) => {
    const from = windows[scene.fromPart][0];
    const to = scene.toPart + 1 < windows.length ? windows[scene.toPart + 1][0] : seconds;
    if (to - from <= MAX_SCENE_SECONDS || scene.toPart === scene.fromPart) {
      result.push(scene);
      return;
    }
    const middle = scene.fromPart + Math.floor((scene.toPart - scene.fromPart + 1) / 2);
    split({ ...scene, toPart: middle - 1 });
    split({ ...scene, fromPart: middle });
  };
  scenes.forEach(split);
  return result;
}

export function timeScenes(scenes: Scene[], parts: string[], windows: [number, number][], seconds: number): TimedScene[] {
  return scenes.map((scene, index) => {
    const from = index === 0 ? 0 : windows[scene.fromPart][0];
    const to = index === scenes.length - 1 ? seconds : windows[scenes[index + 1].fromPart][0];
    const captions = [];
    for (let part = scene.fromPart; part <= scene.toPart; part++) {
      const captionFrom = Math.max(from, windows[part][0]);
      const captionTo = part === scene.toPart ? to : windows[part + 1][0];
      captions.push({ text: parts[part], from: captionFrom - from, to: Math.max(captionTo - from, captionFrom - from + 0.2) });
    }
    return { ...scene, from, to, captions };
  });
}

export async function writeStoryboard(
  agent: AgentModel,
  input: { storyTitle: string; bible: Bible; parts: string[]; windows: [number, number][]; seconds: number; signal?: AbortSignal }
): Promise<Scene[]> {
  let problem: string | undefined;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (input.signal?.aborted) throw new Error(t("Stopped"));
    const reply = await agent.complete(
      storyboardPrompt(input.storyTitle, input.bible, input.parts, input.windows, input.seconds, problem)
    );
    try {
      return parseStoryboard(reply, input.bible, input.parts.length);
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(t("The agent could not plan the scenes: {problem}", { problem: problem ?? "" }));
}

// What a cached storyboard was made from: another bible or other text means a new one.
export function storyboardKey(bible: Bible, parts: string[]): string {
  return createHash("sha1").update(JSON.stringify([bible.createdAt, bible.characters.map((c) => c.id), parts])).digest("hex");
}

function storyboardFile(dataDir: string, storyId: string, order: number): string {
  return path.join(dataDir, "illustrated", storyId, `${order}.storyboard.json`);
}

export async function readStoryboard(dataDir: string, storyId: string, order: number, key: string): Promise<Scene[] | undefined> {
  try {
    const saved = JSON.parse(await fs.readFile(storyboardFile(dataDir, storyId, order), "utf8")) as { key: string; scenes: Scene[] };
    return saved.key === key ? saved.scenes : undefined;
  } catch {
    return undefined;
  }
}

export async function saveStoryboard(dataDir: string, storyId: string, order: number, key: string, scenes: Scene[]): Promise<void> {
  const file = storyboardFile(dataDir, storyId, order);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ key, scenes }));
}
