import type { LlmConfig } from "../config.ts";
import { CliError } from "../errors.ts";
import { chatJudge } from "./chat.ts";
import type { Judge } from "./judge.ts";

/** What a `baseUrl` server gets when the environment has no key: most expect a bearer token and check none. */
export const PLACEHOLDER_KEY = "lawbook";

/** `OPENAI_API_KEY`, else a placeholder for the server `llm.baseUrl` names, else an input error. */
export function openaiKey(llm: LlmConfig, env: NodeJS.ProcessEnv): string {
  const key = env.OPENAI_API_KEY ?? (llm.baseUrl === undefined ? undefined : PLACEHOLDER_KEY);
  if (key === undefined) {
    throw new CliError("openai: set OPENAI_API_KEY in the environment");
  }
  return key;
}

/**
 * Judges through the OpenAI API, or any server that speaks Chat Completions
 * when `llm.baseUrl` names one. The key comes from `OPENAI_API_KEY`.
 */
export async function openaiJudge(llm: LlmConfig, env: NodeJS.ProcessEnv): Promise<Judge> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: llm.baseUrl, apiKey: openaiKey(llm, env) });
  return chatJudge((params) => client.chat.completions.parse(params), llm.model);
}
