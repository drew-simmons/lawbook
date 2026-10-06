import type { LlmConfig } from "../config.ts";
import { chatJudge } from "./chat.ts";
import type { Judge } from "./judge.ts";
import { PLACEHOLDER_KEY } from "./openai.ts";

/** Where a gateway started with `npx -y @maximhq/bifrost` answers the OpenAI SDK. */
export const DEFAULT_BIFROST_URL = "http://localhost:8080/openai";

/** `BIFROST_API_KEY`, a virtual key for a gateway that requires one, else a placeholder it ignores. */
export function bifrostKey(env: NodeJS.ProcessEnv): string {
  return env.BIFROST_API_KEY ?? PLACEHOLDER_KEY;
}

/**
 * Judges through a Bifrost gateway, which speaks Chat Completions and sends
 * each request to the provider named in `model`, such as
 * `bedrock/anthropic.claude-haiku-4-5` or `anthropic/claude-opus-5-5`, with
 * the credentials configured in the gateway. Lawbook holds none.
 */
export async function bifrostJudge(llm: LlmConfig, env: NodeJS.ProcessEnv): Promise<Judge> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    baseURL: llm.baseUrl ?? DEFAULT_BIFROST_URL,
    apiKey: bifrostKey(env),
  });
  return chatJudge((params) => client.chat.completions.parse(params), llm.model, "bifrost");
}
