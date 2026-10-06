import { describe, expect, it } from "vitest";
import { claudeArgs, codexArgs, OPENCODE_CONFIG } from "./agentCli";

// The agent reads text from a crawled page and the person's own setup may have MCP servers (with
// credentials) in it: these are what keep every tool away from it. If one is lost, the agent can go
// and search GitHub or call a tracker on a web page's say-so.
describe("agent tools are off", () => {
  it("Claude Code: no built-in tool, no MCP server, no slash commands or skills, nothing saved", () => {
    const args = claudeArgs();
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
    expect(args).toEqual(expect.arrayContaining(["-p", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]));
    expect(args).not.toContain("--mcp-config");
    expect(claudeArgs("sonnet").slice(-2)).toEqual(["--model", "sonnet"]);
  });

  it("Codex: read-only sandbox, the person's config (MCP servers) ignored, no web search", () => {
    const args = codexArgs("/tmp/x", "/tmp/x/reply.txt", "m");
    expect(args).toEqual(expect.arrayContaining(["--sandbox", "read-only", "--ephemeral", "--ignore-user-config"]));
    expect(args).toContain('web_search="disabled"');
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args.slice(-3)).toEqual(["-m", "m", "-"]);
    expect(codexArgs("/tmp/x", "/tmp/x/reply.txt").slice(-1)).toEqual(["-"]);
  });

  it("opencode: every tool (MCP and plugins included) off and every permission refused, over the person's config", () => {
    expect(JSON.parse(OPENCODE_CONFIG)).toEqual({ tools: { "*": false }, permission: { "*": "deny" } });
  });
});
