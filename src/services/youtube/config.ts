import os from "os";
import path from "path";
import { settingsStore } from "../settingsStore";

/**
 * YouTube publishing defaults, install-wide like the agent crawler settings. The client
 * secret is only a path: the file itself stays where the user keeps it, and the OAuth
 * tokens live in DATA_DIR/youtube/account.json (services/youtube/account.ts).
 */
export interface YouTubeConfig {
  // The brand name in video titles and playlist names (e.g. "Truyện FM").
  channel: string;
  // Google OAuth client JSON ("Desktop app" type).
  clientSecretPath: string;
  // "" = look on PATH; set when ffmpeg is somewhere unusual (packaged app).
  ffmpegPath: string;
  genreTags: string;
  // "18:00" — the "Cập nhật mỗi tối lúc …" line and the default schedule time.
  scheduleTime: string;
  musicId?: string;
  musicVolume: number;
  // AI narration is synthetic media; YouTube asks for the disclosure.
  syntheticMedia: boolean;
}

export const DEFAULT_YOUTUBE_CONFIG: YouTubeConfig = {
  channel: "Truyện FM",
  clientSecretPath: "~/.config/truyen-fm/client_secret.json",
  ffmpegPath: "",
  genreTags: "truyện ngôn tình",
  scheduleTime: "18:00",
  musicVolume: 0.15,
  syntheticMedia: true,
};

const KEY = "youtube";

export function loadYouTubeConfig(): YouTubeConfig {
  try {
    const raw = settingsStore.getRaw(KEY);
    return { ...DEFAULT_YOUTUBE_CONFIG, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_YOUTUBE_CONFIG };
  }
}

export function saveYouTubeConfig(config: YouTubeConfig): void {
  settingsStore.setRaw(KEY, JSON.stringify(config));
}

export function expandHome(filePath: string): string {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}
