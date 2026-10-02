import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../toc/http", () => ({ fetchWithRetry: vi.fn() }));

import { fetchWithRetry } from "../toc/http";
import { createProvider, findProvider, PROVIDERS } from "./providers";

const mockedFetch = vi.mocked(fetchWithRetry);
const options = { toc: "chapter list", body: "chapter text" };

function reply(body: unknown, status = 200) {
  mockedFetch.mockResolvedValueOnce(
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status })
  );
}
const sentBody = () => JSON.parse(String(mockedFetch.mock.calls[0][1]?.body));
const sentHeaders = () => mockedFetch.mock.calls[0][1]?.headers as Record<string, string>;

describe("provider registry", () => {
  it("has unique ids and finds a provider by id", () => {
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length);
    expect(findProvider("ollama")?.keyRequired).toBe(false);
    expect(findProvider("nope")).toBeUndefined();
  });

  it("refuses an unknown provider", () => {
    expect(() => createProvider("nope", { apiKey: "k" })).toThrow(/Unknown AI provider/);
  });
});

describe("OpenAI-compatible provider", () => {
  beforeEach(() => mockedFetch.mockReset());

  it("posts to the preset URL with a bearer key and picks the key named in the reply", async () => {
    reply({ choices: [{ message: { content: "Answer: `body`." } }] });
    const choice = await createProvider("openai", { apiKey: "sk-1" }).choose("which?", "state", options);
    expect(choice).toBe("body");
    expect(mockedFetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(sentHeaders().authorization).toBe("Bearer sk-1");
    expect(sentBody()).toMatchObject({ model: "gpt-4o-mini", temperature: 0 });
  });

  it("honours a custom base URL (trailing slashes trimmed) and model, and sends no key when empty", async () => {
    reply({ choices: [{ message: { content: "toc" } }] });
    await createProvider("ollama", { apiKey: "", baseUrl: "http://proxy/v1//", model: "m" }).choose("q", "s", options);
    expect(mockedFetch.mock.calls[0][0]).toBe("http://proxy/v1/chat/completions");
    expect(sentHeaders().authorization).toBeUndefined();
    expect(sentBody().model).toBe("m");
  });

  it("rejects a reply that names no option", async () => {
    reply({ choices: [{ message: { content: "no idea" } }] });
    await expect(createProvider("openai", { apiKey: "k" }).choose("q", "s", options)).rejects.toThrow(
      /outside the options/
    );
  });

  it("rejects a reply with no text", async () => {
    reply({ choices: [] });
    await expect(createProvider("openai", { apiKey: "k" }).choose("q", "s", options)).rejects.toThrow(/no text/);
  });

  it("reports an HTTP error with the status", async () => {
    reply("quota exceeded", 429);
    await expect(createProvider("openai", { apiKey: "k" }).choose("q", "s", options)).rejects.toThrow(/HTTP 429/);
  });
});

describe("Anthropic provider", () => {
  beforeEach(() => mockedFetch.mockReset());

  it("sends the system prompt separately and reads the text blocks", async () => {
    reply({ content: [{ type: "text", text: "to" }, { type: "text", text: "c" }] });
    const choice = await createProvider("anthropic", { apiKey: "a-key" }).choose("q", "s", options);
    expect(choice).toBe("toc");
    expect(mockedFetch.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(sentHeaders()["x-api-key"]).toBe("a-key");
    const body = sentBody();
    expect(body.system).toMatch(/exactly one option key/);
    expect(body.messages.every((m: { role: string }) => m.role === "user")).toBe(true);
  });

  it("rejects an empty reply", async () => {
    reply({ content: [] });
    await expect(createProvider("anthropic", { apiKey: "k" }).choose("q", "s", options)).rejects.toThrow(/no text/);
  });
});

describe("Jev provider", () => {
  beforeEach(() => mockedFetch.mockReset());

  it("asks a typed choice question and returns the chosen key", async () => {
    reply({ answers: { answer: { choice: "body" } } });
    const choice = await createProvider("jev", { apiKey: "j" }).choose("q", "s", options);
    expect(choice).toBe("body");
    expect(mockedFetch.mock.calls[0][0]).toBe("https://api.typesafe.ai/v1/systemone");
    expect(sentBody().questions.answer).toEqual({ type: "choice", instructions: "q", criteria: options });
  });

  it("rejects a choice that is not one of the options", async () => {
    reply({ answers: { answer: { choice: "other" } } });
    await expect(createProvider("jev", { apiKey: "j" }).choose("q", "s", options)).rejects.toThrow(
      /outside the options/
    );
  });
});
