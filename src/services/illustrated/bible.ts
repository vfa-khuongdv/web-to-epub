import fs from "fs/promises";
import path from "path";
import { AgentModel } from "../agent/agentConfig";
import { t } from "../lang";
import { sanitizeSvg } from "./svg";
import { Bible, Character, EXPRESSIONS, Expression } from "./types";

const MAX_CHARACTERS = 6;
const ATTEMPTS = 3;

export function bibleFile(dataDir: string, storyId: string): string {
  return path.join(dataDir, "illustrated", storyId, "bible.json");
}

export async function loadBible(dataDir: string, storyId: string): Promise<Bible | undefined> {
  try {
    const bible = JSON.parse(await fs.readFile(bibleFile(dataDir, storyId), "utf8")) as Bible;
    return Array.isArray(bible.characters) && bible.characters.length > 0 ? bible : undefined;
  } catch {
    return undefined;
  }
}

export async function saveBible(dataDir: string, storyId: string, bible: Bible): Promise<void> {
  const file = bibleFile(dataDir, storyId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(bible, null, 2));
}

export async function removeBible(dataDir: string, storyId: string): Promise<void> {
  await fs.rm(path.dirname(bibleFile(dataDir, storyId)), { recursive: true, force: true });
}

export function biblePrompt(storyTitle: string, excerpt: string, problem?: string): string {
  return [
    "Bạn là họa sĩ minh hoạ cho video truyện audio. Hãy đọc phần đầu truyện và vẽ các nhân vật chính (tối đa " + MAX_CHARACTERS + ") bằng SVG phẳng đơn giản.",
    "Mỗi nhân vật được vẽ MỘT LẦN và dùng lại ở mọi cảnh, nên phải dựa đúng vào những gì truyện tả (tuổi, tóc, trang phục, màu sắc đặc trưng); không bịa nhân vật không có trong truyện.",
    "Cả bộ dùng chung MỘT phong cách (hình khối phẳng, cùng độ dày nét, cùng kiểu mặt) và một bảng màu hài hoà.",
    "",
    "Quy cách SVG cho mỗi nhân vật:",
    "- body: thân hình, tóc, mũ, quần áo, giày, chân tay — KHÔNG có mắt, mũi, miệng, lông mày. Toạ độ cục bộ: bàn chân chạm y=0, nhân vật cao khoảng 430 đơn vị (đầu quanh y=-380), căn giữa x=0, nhìn về bên phải. Đầu là một hình tròn/elip bán kính khoảng 70–80.",
    "- headY: toạ độ y của TÂM đầu (số âm, ví dụ -380).",
    "- faces: 5 biểu cảm neutral, smile, sad, surprised, laugh. Mỗi biểu cảm chỉ gồm mắt, lông mày, miệng (có thể thêm má hồng) vẽ quanh (0,0) = tâm đầu, trong phạm vi khoảng ±60. Hai bên mắt cách nhau khoảng 44.",
    "- Chỉ được dùng các thẻ g, path, rect, circle, ellipse, line, polyline, polygon và các thuộc tính d, x, y, cx, cy, r, rx, ry, width, height, x1, y1, x2, y2, points, fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, opacity, fill-opacity, stroke-opacity, transform.",
    "- Màu dạng #rrggbb. KHÔNG dùng gradient/url(#...), text, image, style, script, id, class.",
    "",
    "Trả về DUY NHẤT một JSON, không giải thích, không markdown:",
    '{"style":"một câu mô tả phong cách","characters":[{"id":"chữ-thường-không-dấu-gạch-ngang","name":"Tên trong truyện","description":"mô tả ngắn ngoại hình theo truyện","headY":-380,"body":"<g>…</g>","faces":{"neutral":"<g>…</g>","smile":"<g>…</g>","sad":"<g>…</g>","surprised":"<g>…</g>","laugh":"<g>…</g>"}}]}',
    ...(problem ? ["", `Lần trước bị từ chối vì: ${problem}. Hãy sửa lỗi đó và trả về JSON đầy đủ.`] : []),
    "",
    `Truyện "${storyTitle}", phần đầu:`,
    excerpt,
  ].join("\n");
}

function fail(message: string): never {
  throw new Error(message);
}

// Checks one reply and returns the bible, or throws a message the next attempt is told.
export function parseBible(reply: string): Bible {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) fail("không có JSON");
  let value: { style?: unknown; characters?: unknown };
  try {
    value = JSON.parse(reply.slice(start, end + 1));
  } catch {
    fail("JSON không hợp lệ");
  }
  if (!Array.isArray(value.characters) || value.characters.length === 0) fail("thiếu danh sách characters");
  if (value.characters.length > MAX_CHARACTERS) fail(`tối đa ${MAX_CHARACTERS} nhân vật`);
  const ids = new Set<string>();
  const characters: Character[] = value.characters.map((raw: Record<string, unknown>, index: number) => {
    const label = `nhân vật ${index + 1}`;
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!/^[a-z0-9-]{1,30}$/.test(id)) fail(`${label}: id phải là chữ thường không dấu/số/gạch ngang`);
    if (ids.has(id)) fail(`${label}: id trùng`);
    ids.add(id);
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
    if (!name) fail(`${label}: thiếu name`);
    const headY = Number(raw.headY);
    if (!Number.isFinite(headY) || headY > -200 || headY < -600) fail(`${label}: headY phải nằm giữa -600 và -200`);
    const body = sanitizeSvg(raw.body);
    if (!body) fail(`${label}: body không phải SVG hợp lệ theo quy cách (chỉ thẻ/thuộc tính cho phép, không gradient/text)`);
    const rawFaces = (raw.faces ?? {}) as Record<string, unknown>;
    const faces = {} as Record<Expression, string>;
    for (const expression of EXPRESSIONS) {
      const face = sanitizeSvg(rawFaces[expression]);
      if (!face) fail(`${label}: faces.${expression} không phải SVG hợp lệ theo quy cách`);
      faces[expression] = face;
    }
    return {
      id,
      name,
      description: typeof raw.description === "string" ? raw.description.trim().slice(0, 300) : "",
      body,
      headY,
      faces,
    };
  });
  const style = typeof value.style === "string" ? value.style.trim().slice(0, 200) : "";
  return { style: style || "flat illustration", characters, createdAt: new Date().toISOString() };
}

// "Try, validate, feed the problem back", like the crawler: the drawings are the part a
// model most often gets slightly wrong, and the reason is specific enough to fix.
export async function writeBible(
  agent: AgentModel,
  input: { storyTitle: string; excerpt: string; signal?: AbortSignal }
): Promise<Bible> {
  let problem: string | undefined;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (input.signal?.aborted) throw new Error(t("Stopped"));
    const reply = await agent.complete(biblePrompt(input.storyTitle, input.excerpt, problem));
    try {
      return parseBible(reply);
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(t("The agent could not draw the characters: {problem}", { problem: problem ?? "" }));
}
