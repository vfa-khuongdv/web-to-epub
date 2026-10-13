import { ContentBlock } from "../../types";
import { reportAgent } from "../agent/agentActivity";
import { AgentModel } from "../agent/agentConfig";
import { t } from "../lang";
import { blockText, chunkParagraphs, parseRewriteReply, rewritePrompt, validateRewrite, RewriteProblem } from "./rewriteText";

/**
 * Asking the agent to rewrite one chapter's paragraphs for narration. The chapter's other
 * blocks (images, tables, headings) are left exactly where they are; only paragraph runs
 * between them are sent, in chunks, and a chunk is accepted only after the checks in
 * rewriteText.ts pass — the same "try, validate, feed the problem back" loop the crawler uses.
 */
const ATTEMPTS = 3;

export class RewriteCancelledError extends Error {}

export interface RewriteContext {
  // The story title, shown in the agent activity log.
  host: string;
  order: number;
  signal?: AbortSignal;
  onProgress?: (chunk: number, chunks: number) => void;
}

async function rewriteChunk(
  agent: AgentModel,
  paragraphs: string[],
  context: RewriteContext,
  chunk: number,
  chunks: number
): Promise<string[]> {
  let previous: RewriteProblem | undefined;
  context.onProgress?.(chunk, chunks);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (context.signal?.aborted) throw new RewriteCancelledError();
    reportAgent({
      kind: "ask",
      host: context.host,
      fn: "rewrite",
      agent: agent.name,
      order: context.order,
      attempt,
      of: ATTEMPTS,
    });
    const started = Date.now();
    let lines: string[] | undefined;
    let problem: string;
    try {
      const reply = await agent.complete(rewritePrompt(paragraphs, previous));
      reportAgent({
        kind: "answer",
        host: context.host,
        fn: "rewrite",
        agent: agent.name,
        order: context.order,
        ms: Date.now() - started,
      });
      lines = parseRewriteReply(reply);
      problem = validateRewrite(paragraphs, lines) ?? "";
      if (!problem) return lines;
    } catch (err) {
      if (err instanceof RewriteCancelledError) throw err;
      problem = err instanceof Error ? err.message : String(err);
    }
    reportAgent({
      kind: "retry",
      host: context.host,
      fn: "rewrite",
      order: context.order,
      attempt,
      reason: problem,
    });
    previous = { attempt: (lines ?? []).join("\n"), problem };
  }
  throw new Error(t("The agent could not rewrite this chapter: {reason}", { reason: previous?.problem ?? "" }));
}

// One run of consecutive paragraphs is rewritten together so a chunk never mixes two
// unrelated stretches of the chapter.
export async function rewriteChapterBlocks(
  agent: AgentModel,
  blocks: ContentBlock[],
  context: RewriteContext
): Promise<ContentBlock[]> {
  const result: ContentBlock[] = [];
  let run: string[] = [];
  const flush = async () => {
    if (run.length === 0) return;
    const chunks = chunkParagraphs(run);
    const rewritten: string[] = [];
    for (let index = 0; index < chunks.length; index++) {
      rewritten.push(...(await rewriteChunk(agent, chunks[index], context, index, chunks.length)));
    }
    result.push(...rewritten.map((text) => ({ type: "paragraph" as const, text })));
    run = [];
  };
  for (const block of blocks) {
    const text = block.type === "paragraph" ? blockText(block.text ?? "") : "";
    if (block.type === "paragraph" && text) {
      run.push(text);
      continue;
    }
    await flush();
    result.push(block);
  }
  await flush();
  return result;
}
