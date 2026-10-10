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

// Descriptions should not read identically from one video to the next. The wording is picked
// from a seed (story + chapter), not at random, so the panel's preview is what gets uploaded
// and re-preparing a chapter gives the same text.
export function pickVariant<T>(seed: string, options: readonly T[]): T {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return options[hash % options.length];
}

const CHAPTER_OPENINGS = [
  (title: string, order: number) => `🎧 Nghe truyện audio "${title}" – Chương ${order}.`,
  (title: string, order: number) => `🌙 Chương ${order} của "${title}" đã sẵn sàng – đeo tai nghe vào và nghe tiếp thôi!`,
  (title: string, order: number) => `🎙️ "${title}" – Chương ${order}: càng nghe càng cuốn.`,
  (title: string, order: number) => `🔥 "${title}" – Chương ${order}: đã nghe là khó dừng.`,
  (title: string, order: number) => `✨ Cùng nghe tiếp "${title}" – Chương ${order}, diễn biến ngày càng hấp dẫn.`,
];

const CHANNEL_CALLS = [
  (channel: string) => `🔔 Đăng ký kênh ${channel} và bấm chuông để không bỏ lỡ chương mới.`,
  (channel: string) => `❤️ Thích câu chuyện này? Theo dõi kênh ${channel} để nghe những chương tiếp theo ngay khi lên sóng.`,
  (channel: string) => `📲 Bấm đăng ký kênh ${channel} – mỗi chương mới sẽ đến với bạn đúng giờ.`,
  (channel: string) => `💬 Nghe xong, để lại cảm nghĩ của bạn dưới phần bình luận và đăng ký kênh ${channel} nhé!`,
];

export function chapterOpening(storyTitle: string, order: number): string {
  return pickVariant(`${storyTitle}#${order}`, CHAPTER_OPENINGS)(storyTitle, order);
}

export function channelCall(seed: string, channel: string): string {
  return pickVariant(seed, CHANNEL_CALLS)(channel);
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
  const lines = [chapterOpening(input.storyTitle, input.order), ""];
  const summary = input.summary?.trim();
  if (summary) lines.push(`📖 ${summary}`, "");
  const author = input.author?.trim();
  const translator = input.translator?.trim();
  const schedule = input.scheduleTime?.trim();
  if (author) lines.push(`✍️ Tác giả: ${author}`);
  if (translator) lines.push(`🌐 Dịch: ${translator}`);
  if (schedule) lines.push(`⏰ Cập nhật mỗi tối lúc ${schedule}.`);
  if (author || translator || schedule) lines.push("");
  const channelHashtag = hashtagFromTitle(input.channel);
  lines.push(
    channelCall(`${input.storyTitle}#${input.order}`, input.channel),
    "",
    [channelHashtag && `#${channelHashtag}`, `#${hashtagFromTitle(input.storyTitle)}`, "#TruyệnAudio", "#NgheTruyện"]
      .filter(Boolean)
      .join(" ")
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
