import { APIError } from "@anthropic-ai/sdk/error";
import { DEFAULT_MODELS, type LlmConfig } from "../config.ts";
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

/** The id without an inference-profile prefix, a date, or a version: `us.anthropic.claude-haiku-4-5-20251001-v1:0` is `anthropic.claude-haiku-4-5`. */
export function undatedModelId(model: string): string {
  return model
    .replace(/^(?:us|us-gov|eu|apac|jp|au|ca|global)\./, "")
    .replace(/(?:-\d{8})?(?:-v\d+(?::\d+)?)?$/, "");
}

/** What to do about an id the Messages endpoint answered 404 to. */
export function unknownModelMessage(model: string, region: string): string {
  const undated = undatedModelId(model);
  const advice =
    undated === model
      ? `it serves only some of the models Bedrock lists; name one it serves, such as ${DEFAULT_MODELS.bedrock}`
      : `name it in the undated anthropic.<model> form, ${undated}`;
  return `bedrock: the Bedrock Messages endpoint in ${region} does not know the model id ${model}; ${advice}`;
}

/**
 * The Messages endpoint knows models by undated `anthropic.<model>` ids,
 * and not every model Bedrock lists. Its 404 becomes the advice; any other
 * error passes on unchanged.
 */
export function unknownModel(model: string, region: string): (error: unknown) => never {
  return (error) => {
    if (error instanceof APIError && error.status === 404) {
      throw new CliError(unknownModelMessage(model, region));
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
  const region = bedrockRegion(llm, env);
  const client = new AnthropicBedrockMantle({ awsRegion: region });
  return messagesJudge(
    (params) => client.messages.create(params).catch(unknownModel(llm.model, region)),
    llm.model,
    "bedrock",
  );
}
