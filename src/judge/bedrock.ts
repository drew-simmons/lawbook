import type { LlmConfig } from "../config.ts";
import { APIError as AnthropicApiError } from "@anthropic-ai/sdk/error";
import { APIError as OpenAiApiError } from "openai/error";
import { CliError } from "../errors.ts";
import { chatToolJudge } from "./chat.ts";
import type { Judge } from "./judge.ts";
import { messagesToolJudge } from "./messages.ts";

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

/** Where a Bedrock judge sends its requests, and how it authenticates. */
export interface BedrockTarget {
  model: string;
  region: string;
  env: NodeJS.ProcessEnv;
  /** The `fetch` the SDK client uses; tests pass a fake. */
  fetch?: typeof fetch;
}

/** The geography an inference-profile id starts with, such as `us.` or `global.`. */
const PROFILE_PREFIX = /^(?:us|us-gov|eu|apac|jp|au|ca|global)\./;

/** The model id without its inference-profile prefix: `us.openai.gpt-5.5` is `openai.gpt-5.5`. */
export function baseModelId(model: string): string {
  return model.replace(PROFILE_PREFIX, "");
}

/** The undated id the Messages endpoint knows: `anthropic.claude-haiku-4-5-20251001-v1:0` is `anthropic.claude-haiku-4-5`. */
export function undatedModelId(model: string): string {
  return baseModelId(model).replace(/(?:-\d{8})?(?:-v\d+(?::\d+)?)?$/, "");
}

/** The Messages endpoint's 404 for a model it does not serve, as what to name instead. */
export function unknownModelMessage(model: string): string {
  const undated = undatedModelId(model);
  const advice =
    undated === model
      ? `it takes undated anthropic.<model> ids, and ${model} is not one it serves`
      : `name it in the undated anthropic.<model> form, ${undated}`;
  return `bedrock: the Bedrock Messages endpoint does not know the model id ${model}; ${advice}`;
}

/** A 404 from the Messages endpoint means the model id; anything else passes on unchanged. */
export function unknownModel(model: string): (error: unknown) => never {
  return (error) => {
    if (error instanceof AnthropicApiError && error.status === 404) {
      throw new CliError(unknownModelMessage(model));
    }
    throw error;
  };
}

/** Bedrock's 400 for a model it serves only through an inference profile. */
const ON_DEMAND = /on-demand throughput isn.t supported/;

/** The on-demand-throughput 400 as the inference-profile id to use; anything else passes on unchanged. */
export function needsInferenceProfile(model: string): (error: unknown) => never {
  return (error) => {
    if (error instanceof OpenAiApiError && error.status === 400 && ON_DEMAND.test(error.message)) {
      throw new CliError(
        `bedrock: ${model} has no on-demand throughput; use its inference-profile id, such as us.${baseModelId(model)}`,
      );
    }
    throw error;
  };
}

/** `AWS_BEARER_TOKEN_BEDROCK` as the key when it is set; otherwise the SDK signs with SigV4. */
export function bearerKey(env: NodeJS.ProcessEnv): { apiKey?: string } {
  const apiKey = env.AWS_BEARER_TOKEN_BEDROCK;
  return apiKey === undefined ? {} : { apiKey };
}

/**
 * Anthropic models through Bedrock's Messages endpoint (bedrock-mantle). It
 * rejects structured output, so the answer comes back as a tool call.
 */
export async function bedrockMessagesJudge(target: BedrockTarget): Promise<Judge> {
  const { AnthropicBedrockMantle } = await import("@anthropic-ai/bedrock-sdk");
  const client = new AnthropicBedrockMantle({
    awsRegion: target.region,
    fetch: target.fetch,
    ...bearerKey(target.env),
  });
  return messagesToolJudge(
    (params) => client.messages.create(params).catch(unknownModel(target.model)),
    target.model,
    "bedrock",
  );
}

/**
 * OpenAI models through Bedrock's Chat Completions endpoint on
 * bedrock-runtime, with the bearer token or SigV4. The open-weight models
 * write reasoning ahead of any response-format JSON, so the answer comes
 * back as a function call.
 */
export async function bedrockChatJudge(target: BedrockTarget): Promise<Judge> {
  const [{ default: OpenAI }, { bedrock }] = await Promise.all([
    import("openai"),
    import("openai/providers/bedrock/aws"),
  ]);
  const provider = bedrock({
    endpoint: "runtime",
    region: target.region,
    ...bearerKey(target.env),
  });
  const client = new OpenAI({ provider, fetch: target.fetch });
  return chatToolJudge(
    (params) => client.chat.completions.create(params).catch(needsInferenceProfile(target.model)),
    target.model,
    "bedrock",
  );
}

/** The model family, after any inference-profile prefix, picks the endpoint. */
export const BEDROCK_ROUTES = new Map<string, (target: BedrockTarget) => Promise<Judge>>([
  ["anthropic", bedrockMessagesJudge],
  ["openai", bedrockChatJudge],
]);

/** The judge factory for a model id, or an error naming the families lawbook can judge with. */
export function bedrockRoute(model: string): (target: BedrockTarget) => Promise<Judge> {
  const family = baseModelId(model).split(".")[0] ?? "";
  const route = BEDROCK_ROUTES.get(family);
  if (route === undefined) {
    throw new CliError(
      `bedrock: lawbook judges with anthropic.* and openai.* models; ${model} is neither`,
    );
  }
  return route;
}

/**
 * Judges through Amazon Bedrock. The model id picks the endpoint; the SDKs
 * load on first use, so runs without LLM rules never pay for them.
 */
export async function bedrockJudge(
  llm: LlmConfig,
  env: NodeJS.ProcessEnv,
  fetch?: typeof globalThis.fetch,
): Promise<Judge> {
  const region = bedrockRegion(llm, env);
  return bedrockRoute(llm.model)({ model: llm.model, region, env, fetch });
}
