import type { LlmConfig } from "../config.ts";
import type { Judge } from "./judge.ts";
import { messagesJudge } from "./messages.ts";

/**
 * Judges through the Anthropic API with credentials from the environment
 * (`ANTHROPIC_API_KEY`, or a profile from `ant auth login`).
 */
export async function anthropicJudge(llm: LlmConfig): Promise<Judge> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  return messagesJudge((params) => client.messages.parse(params), llm.model, "anthropic");
}
