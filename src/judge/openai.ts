import type { LlmConfig } from "../config.ts";
import { chatJudge } from "./chat.ts";
import type { Judge } from "./judge.ts";

/**
 * Judges through the OpenAI API, or any server that speaks Chat Completions
 * when `llm.baseUrl` names one. The key comes from `OPENAI_API_KEY`.
 */
export async function openaiJudge(llm: LlmConfig): Promise<Judge> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: llm.baseUrl });
  return chatJudge((params) => client.chat.completions.parse(params), llm.model);
}
