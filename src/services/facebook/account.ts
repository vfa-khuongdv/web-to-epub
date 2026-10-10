import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "../../config/paths";

/**
 * The Facebook Page the person posts to: its id and a long-lived Page access token that
 * they generated for their own app. Install-wide (DATA_DIR/facebook/account.json, mode 0600)
 * like the YouTube account. There is no sign-in flow — the app never sees a password, and
 * a token for a Page the person administers works while the app is in Development mode.
 */
export interface FacebookAccount {
  pageId: string;
  pageName: string;
  pageUrl?: string;
  token: string;
  savedAt: string;
}

export function accountPath(): string {
  return path.join(DATA_DIR, "facebook", "account.json");
}

export async function loadAccount(): Promise<FacebookAccount | undefined> {
  try {
    return JSON.parse(await fs.readFile(accountPath(), "utf8")) as FacebookAccount;
  } catch {
    return undefined;
  }
}

export async function saveAccount(account: FacebookAccount): Promise<void> {
  const file = accountPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(account), { mode: 0o600 });
}

export async function removeAccount(): Promise<void> {
  await fs.rm(accountPath(), { force: true });
}
