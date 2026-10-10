/**
 * Local coding agents (Claude Code, Codex, opencode) as the model behind the AI crawler. The app
 * runs the CLI the user already has, signed in with their own account, once per question, and
 * reads back the option key it names — the same contract as an API provider, so the agent never
 * browses or writes chapter text.
 *
 * The question embeds text from a crawled page, which is untrusted, and the person's own agent setup
 * is not: it may carry MCP servers (GitHub, a tracker, a code index) with real credentials. So every
 * agent runs in an empty temp folder with ALL tools off — built-in ones and everything the person's
 * config adds (MCP servers, plugins) — and only answers in text. An agent that was asked to look
 * something up on the web or in a repository must find it has nothing to do that with.
 */
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export type AgentId = "claude" | "codex" | "opencode";

const BINARY: Record<AgentId, string> = { claude: "claude", codex: "codex", opencode: "opencode" };
const TIMEOUT_MS = 180_000;
const exe = process.platform === "win32" ? [".exe", ".cmd"] : [""];

// A packaged app starts with a minimal PATH, so the places these CLIs install to are searched too.
function searchDirs(): string[] {
  const home = homedir();
  const extra = [
    path.join(home, ".local", "bin"),
    path.join(home, ".opencode", "bin"),
    path.join(home, ".claude", "local"),
    path.join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  return [...(process.env.PATH ?? "").split(path.delimiter), ...extra].filter(Boolean);
}

export function findAgentBinary(agent: AgentId): string | undefined {
  for (const dir of searchDirs()) {
    for (const ext of exe) {
      const file = path.join(dir, BINARY[agent] + ext);
      try {
        accessSync(file, constants.X_OK);
        return file;
      } catch {
        /* next */
      }
    }
  }
  return undefined;
}

// One argument for cmd.exe: wrapped in quotes, inner quotes doubled, `%` neutralised so no variable is expanded.
const winQuote = (a: string) => `"${a.replace(/"/g, '""').replace(/%/g, '"^%"')}"`;

function run(file: string, args: string[], cwd: string, stdin: string, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    // A .cmd shim cannot be spawned directly (Node throws EINVAL on Windows since CVE-2024-27980), so it runs
    // through the command interpreter; `/s` + the outer quotes keep the path and each quoted argument intact.
    const shim = process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
    const child = execFile(
      shim ? (process.env.ComSpec ?? "cmd.exe") : file,
      shim ? ["/d", "/s", "/c", `"${[file, ...args].map(winQuote).join(" ")}"`] : args,
      { cwd, timeout: TIMEOUT_MS, windowsVerbatimArguments: shim, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        // Claude Code prints its own errors (not signed in, model unavailable, too old) on stdout, so that is read too.
        if (err) reject(new Error(`AI agent failed: ${(stderr || stdout || err.message).trim().slice(-300)}`));
        else resolve(stdout);
      }
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(stdin);
  });
}

// What switches the agent's tools off. Each is checked by agentCli.test.ts, because a flag that a new
// version of the CLI stops understanding would quietly give the tools back.
export const claudeArgs = (model?: string): string[] => [
  "-p",
  "--tools",
  "",
  // Without this the MCP servers of the person's own setup are loaded next to the (empty) built-in set.
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--output-format",
  "text",
  ...(model ? ["--model", model] : []),
];

export const codexArgs = (dir: string, out: string, model?: string): string[] => [
  "exec",
  "--sandbox",
  "read-only",
  "--skip-git-repo-check",
  "--ephemeral",
  // The person's config.toml is where MCP servers live; the sign-in (CODEX_HOME) is still used.
  "--ignore-user-config",
  "-c",
  'web_search="disabled"',
  "-C",
  dir,
  "-o",
  out,
  ...(model ? ["-m", model] : []),
  "-",
];

// Merged over the person's opencode config: no tool of any kind, MCP and plugins included, and every permission refused.
export const OPENCODE_CONFIG = JSON.stringify({ tools: { "*": false }, permission: { "*": "deny" } });

// Runs one prompt through the agent and returns its final reply. `model` empty = the agent's own default.
export async function runAgent(agent: AgentId, prompt: string, model?: string): Promise<string> {
  const file = findAgentBinary(agent);
  if (!file) throw new Error(`The ${BINARY[agent]} command was not found on this computer`);
  const dir = await mkdtemp(path.join(tmpdir(), "crawler-agent-"));
  try {
    if (agent === "claude") {
      return await run(file, claudeArgs(model), dir, prompt);
    }
    if (agent === "codex") {
      const out = path.join(dir, "reply.txt");
      await run(file, codexArgs(dir, out, model), dir, prompt);
      return await readFile(out, "utf8");
    }
    // opencode takes the prompt as a message; a page excerpt can be long, so it travels as a file.
    await writeFile(path.join(dir, "question.txt"), prompt);
    const args = ["run", "-f", "question.txt", "--dir", dir];
    if (model) args.push("-m", model);
    return await run(file, [...args, "Answer the question in the attached file."], dir, "", {
      OPENCODE_CONFIG_CONTENT: OPENCODE_CONFIG,
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Models the person can pick for an agent, as the agent itself names them. Claude Code has no list command,
// so its aliases are fixed; the other two are asked. A CLI that cannot answer gives an empty list.
const CLAUDE_MODELS = ["opus", "sonnet", "haiku"];

export function parseModelList(agent: AgentId, output: string): string[] {
  if (agent === "claude") return CLAUDE_MODELS;
  if (agent === "opencode") return output.split("\n").map((l) => l.trim()).filter((l) => /^[\w.-]+\/\S+$/.test(l));
  try {
    const models = (JSON.parse(output) as { models?: { slug?: unknown; visibility?: unknown }[] }).models ?? [];
    return models.filter((m) => typeof m.slug === "string" && m.visibility !== "hide").map((m) => m.slug as string);
  } catch {
    return [];
  }
}

export async function listAgentModels(agent: AgentId): Promise<string[]> {
  if (agent === "claude") return CLAUDE_MODELS;
  const file = findAgentBinary(agent);
  if (!file) return [];
  try {
    const out = await run(file, agent === "opencode" ? ["models"] : ["debug", "models"], tmpdir(), "");
    return parseModelList(agent, out);
  } catch {
    return [];
  }
}
