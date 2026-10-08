import { APIError } from "@anthropic-ai/sdk/error";
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
 * The Messages endpoint knows only undated `anthropic.<model>` ids and
 * answers 404 to dated ones, `us.` prefixes, and versions. That 404 becomes
 * the advice; any other error passes on unchanged.
 */
export function unknownModel(model: string): (error: unknown) => never {
  return (error) => {
    if (error instanceof APIError && error.status === 404) {
      throw new CliError(
        `bedrock: the Bedrock Messages endpoint does not know the model id ${model}; name it in the undated anthropic.<model> form, such as anthropic.claude-haiku-5-5`,
      );
    }
    throw error;
  };
}

/**
 * Judges through Amazon Bedrock's Messages endpoint. The SDK takes
 * credentials from the AWS chain, or `AWS_BEARER_TOKEN_BEDROCK` when the
 * chain has none, and loads on first use, so runs without LLM rules never
 * pay for it.
 */
export async function bedrockJudge(llm: LlmConfig, env: NodeJS.ProcessEnv): Promise<Judge> {
  const { AnthropicBedrockMantle } = await import("@anthropic-ai/bedrock-sdk");
  const client = new AnthropicBedrockMantle({ awsRegion: bedrockRegion(llm, env) });
  return messagesJudge(
    (params) => client.messages.create(params).catch(unknownModel(llm.model)),
    llm.model,
    "bedrock",
  );
}
