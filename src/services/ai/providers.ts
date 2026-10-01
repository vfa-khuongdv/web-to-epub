/**
 * AI providers behind one small interface: `choose` picks one option out of a list. The
 * crawler never lets a model write chapter text; it only asks which candidate element is the
 * chapter list or the chapter body, so a provider that cannot generate free text (Jev) fits
 * the same interface as a chat LLM.
 *
 * Most chat vendors speak the OpenAI chat-completions protocol, so one adapter plus a row of
 * presets covers them (DeepSeek, OpenAI, Gemini, Groq, OpenRouter, Ollama…); Anthropic and Jev
 * have their own protocols. Adding a provider = one `PROVIDERS` row, or a new `kind` adapter.
 */
import { fetchWithRetry } from "../toc/http";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ProviderConfig {
  apiKey: string;
  // Overrides the preset's base URL (a proxy, a self-hosted OpenAI-compatible server).
  baseUrl?: string;
  // Overrides the preset's default model.
  model?: string;
}

export interface AiProvider {
  // Returns the key of the option that best answers `question` about `state`.
  choose(question: string, state: string, options: Record<string, string>): Promise<string>;
}

export interface ProviderInfo {
  id: string;
  name: string;
  kind: "openai" | "anthropic" | "jev";
  baseUrl: string;
  defaultModel: string;
  // Local servers (Ollama) need no key.
  keyRequired: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "deepseek", name: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", keyRequired: true },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", keyRequired: true },
  { id: "gemini", name: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.0-flash", keyRequired: true },
  { id: "groq", name: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", keyRequired: true },
  { id: "openrouter", name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "deepseek/deepseek-chat", keyRequired: true },
  { id: "ollama", name: "Ollama (local)", kind: "openai", baseUrl: "http://localhost:11434/v1", defaultModel: "qwen2.5:14b", keyRequired: false },
  { id: "jev", name: "Jev (TypeSafe)", kind: "jev", baseUrl: "https://api.typesafe.ai/v1", defaultModel: "jev-latest", keyRequired: true },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-haiku-4-5-20251001", keyRequired: true },
];

export function findProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

const REQUEST_TIMEOUT_MS = 120_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetchWithRetry(
    url,
    { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) },
    { timeoutMs: REQUEST_TIMEOUT_MS, maxAttempts: 3 }
  );
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`AI provider answered HTTP ${res.status}: ${detail}`);
  }
  return res.json() as Promise<any>;
}

interface TextCompleter {
  complete(messages: ChatMessage[]): Promise<string>;
}

// A chat model answers a choice by naming the key; take the first option key found in the
// reply so "Answer: toc" and "`toc`." both work.
function chooseWithText(completer: TextCompleter): AiProvider["choose"] {
  return async (question, state, options) => {
    const keys = Object.keys(options);
    const list = keys.map((k) => `- ${k}: ${options[k]}`).join("\n");
    const reply = await completer.complete([
      { role: "system", content: "You analyse web pages. Reply with exactly one option key from the list and nothing else." },
      { role: "user", content: `${question}\n\nOptions:\n${list}\n\nPage data:\n${state}` },
    ]);
    const found = keys.find((k) => reply.includes(k));
    if (!found) throw new Error(`AI provider answered outside the options: ${reply.slice(0, 80)}`);
    return found;
  };
}

function openAiCompatible(info: ProviderInfo, config: ProviderConfig): AiProvider {
  const base = (config.baseUrl || info.baseUrl).replace(/\/+$/, "");
  return {
    choose: chooseWithText({
      async complete(messages) {
        const data = await postJson(
          `${base}/chat/completions`,
          config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
          { model: config.model || info.defaultModel, messages, temperature: 0 }
        );
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== "string") throw new Error("AI provider returned no text");
        return text;
      },
    }),
  };
}

function anthropic(info: ProviderInfo, config: ProviderConfig): AiProvider {
  const base = (config.baseUrl || info.baseUrl).replace(/\/+$/, "");
  return {
    choose: chooseWithText({
      async complete(messages) {
        const data = await postJson(
          `${base}/messages`,
          { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
          {
            model: config.model || info.defaultModel,
            max_tokens: 64,
            temperature: 0,
            system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
            messages: messages.filter((m) => m.role !== "system"),
          }
        );
        const text = (data?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        if (!text) throw new Error("AI provider returned no text");
        return text;
      },
    }),
  };
}

// Jev answers typed questions natively (POST /systemone, `choice` primitive).
function jev(info: ProviderInfo, config: ProviderConfig): AiProvider {
  const base = (config.baseUrl || info.baseUrl).replace(/\/+$/, "");
  return {
    async choose(question, state, options) {
      const data = await postJson(
        `${base}/systemone`,
        { authorization: `Bearer ${config.apiKey}` },
        {
          model: config.model || info.defaultModel,
          state,
          questions: { answer: { type: "choice", instructions: question, criteria: options } },
        }
      );
      const choice = data?.answers?.answer?.choice;
      if (typeof choice !== "string" || !(choice in options)) throw new Error("AI provider answered outside the options");
      return choice;
    },
  };
}

export function createProvider(id: string, config: ProviderConfig): AiProvider {
  const info = findProvider(id);
  if (!info) throw new Error(`Unknown AI provider: ${id}`);
  if (info.kind === "anthropic") return anthropic(info, config);
  if (info.kind === "jev") return jev(info, config);
  return openAiCompatible(info, config);
}
