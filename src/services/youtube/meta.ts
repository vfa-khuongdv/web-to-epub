/**
 * The title, description, tags and playlist name a chapter is uploaded with — the same
 * shape the workspace's upload skill writes into its `- upload.md` files, so the channel
 * stays consistent. Pure functions: the panel previews exactly what will be uploaded.
 */

export function sanitizeYouTubeText(text: string): string {
  // YouTube rejects < and > in titles and descriptions.
  return text.replace(/[<>]/g, "");
}

export function hashtagFromTitle(storyTitle: string): string {
  return storyTitle
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toLocaleUpperCase("vi") + word.slice(1))
    .join("");
}

export function videoTitle(storyTitle: string, order: number, channel: string): string {
  const title = sanitizeYouTubeText(`${storyTitle} – Chương ${order} | ${channel}`);
  return title.length <= 100 ? title : `${title.slice(0, 97).trimEnd()}...`;
}

export function playlistTitle(storyTitle: string, channel: string): string {
  return sanitizeYouTubeText(`${storyTitle} – Truyện Audio Full | ${channel}`);
}

export interface DescriptionInput {
  storyTitle: string;
  order: number;
  channel: string;
  summary?: string;
  author?: string;
  translator?: string;
  scheduleTime?: string;
}

export function descriptionFor(input: DescriptionInput): string {
  const lines = [`🎧 Nghe truyện audio "${input.storyTitle}" – Chương ${input.order}.`, ""];
  const summary = input.summary?.trim();
  if (summary) lines.push(`📖 ${summary}`, "");
  const author = input.author?.trim();
  const translator = input.translator?.trim();
  const schedule = input.scheduleTime?.trim();
  if (author) lines.push(`✍️ Tác giả: ${author}`);
  if (translator) lines.push(`🌐 Dịch: ${translator}`);
  if (schedule) lines.push(`⏰ Cập nhật mỗi tối lúc ${schedule}.`);
  if (author || translator || schedule) lines.push("");
  lines.push(
    `🔔 Đăng ký kênh ${input.channel} và bấm chuông để không bỏ lỡ chương mới.`,
    "",
    "⚠️ Nội dung chỉ nhằm mục đích giải trí.",
    "",
    `#TruyệnFM #${hashtagFromTitle(input.storyTitle)} #TruyệnAudio #NgheTruyện`
  );
  return sanitizeYouTubeText(lines.join("\n"));
}

export interface TagsInput {
  storyTitle: string;
  order: number;
  channel: string;
  genreTags?: string;
}

// The skill's tag list; YouTube caps the whole field at 500 characters.
export function tagsFor(input: TagsInput): string[] {
  const tags = [
    input.storyTitle,
    "truyện audio",
    "nghe truyện",
    input.channel,
    `${input.storyTitle} chương ${input.order}`,
  ];
  if (input.genreTags?.trim()) {
    tags.push(...input.genreTags.split(",").map((tag) => tag.trim()).filter(Boolean));
  }
  tags.push("nghe truyện đêm khuya");
  const result: string[] = [];
  let length = 0;
  for (const tag of new Set(tags.map((tag) => sanitizeYouTubeText(tag.trim())))) {
    if (!tag || tag.length > 100) continue;
    if (length + tag.length + 1 > 500) break;
    result.push(tag);
    length += tag.length + 1;
  }
  return result;
}
