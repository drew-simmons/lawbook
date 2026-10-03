import type { LlmConfig } from "../config.ts";
import { CliError } from "../errors.ts";
import type { Judge } from "./judge.ts";
import { messagesJudge } from "./messages.ts";

/** `llm.region`, else the AWS environment variables, else an input error. */
export function bedrockRegion(llm: LlmConfig, env: NodeJS.ProcessEnv): string {
  const region = llm.region ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
  if (region === undefined) {
    throw new CliError(
      "bedrock: set llm.region in the config, or AWS_REGION or AWS_DEFAULT_REGION in the environment",
    );
  }
  return region;
}

/**
 * Judges through Amazon Bedrock with the AWS credential chain. The SDK loads
 * on first use, so runs without LLM rules never pay for it.
 */
export async function bedrockJudge(llm: LlmConfig, env: NodeJS.ProcessEnv): Promise<Judge> {
  const { AnthropicBedrockMantle } = await import("@anthropic-ai/bedrock-sdk");
  const client = new AnthropicBedrockMantle({ awsRegion: bedrockRegion(llm, env) });
  return messagesJudge((params) => client.messages.parse(params), llm.model, "bedrock");
}
