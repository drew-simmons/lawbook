/**
 * The Anthropic Messages exchange behind the Bedrock adapter. Bedrock's
 * Messages endpoint rejects `output_config` and `tools[].strict`, so the
 * answer comes back as a plain call to one `answer` tool. The instruction
 * to call it sits after the cache marker, so the cached prefix is the
 * system prompt, the standard, and any reference material, as before.
 */
import { AnthropicError } from "@anthropic-ai/sdk/error";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  TextBlockParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { CliError } from "../errors.ts";
import {
  answerJsonSchema,
  type Judge,
  type JudgeRequest,
  parseAnswer,
  type Usage,
  type Verdict,
} from "./judge.ts";
import { fileBlocks, requestLabel, systemTexts } from "./prompt.ts";

export const ANSWER_TOOL = "answer";

/** The last system block, after the cached prefix: how the model is to answer. */
export const TOOL_INSTRUCTION = `Answer by calling the ${ANSWER_TOOL} tool once, with the probability and the reason as its input, and nothing else.`;

/** Room for the thinking the newer models do before the call; 1024 can stop short of it. */
export const MAX_TOKENS = 4096;

/** `client.messages.create` from an Anthropic SDK client; tests pass a stub. */
export type CreateFn = (params: MessageCreateParamsNonStreaming) => Promise<Message>;

/** The texts as blocks, the last one marked so the provider caches the whole prefix. */
function withCacheControl(texts: string[]): TextBlockParam[] {
  return texts.map((text, index) =>
    index === texts.length - 1
      ? { type: "text", text, cache_control: { type: "ephemeral" } }
      : { type: "text", text },
  );
}

/** The one tool the model may call: its input is the answer. */
export function answerTool(): Tool {
  return {
    name: ANSWER_TOOL,
    description: "Record the verdict: the probability that the files meet the standard, and why.",
    input_schema: { type: "object", ...answerJsonSchema() },
  };
}

export function buildRequest(
  request: JudgeRequest,
  model: string,
): MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: [...withCacheControl(systemTexts(request)), { type: "text", text: TOOL_INSTRUCTION }],
    messages: [{ role: "user", content: fileBlocks(request.files) }],
    tools: [answerTool()],
    tool_choice: { type: "auto" },
  };
}

/** The provider's counts in lawbook's names; a provider without a cache reports null. */
export function toUsage(usage: Message["usage"]): Usage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/** The call to the answer tool, whatever the model wrote around it, or undefined. */
function answerCall(message: Message): ToolUseBlock | undefined {
  return message.content.find(
    (block): block is ToolUseBlock => block.type === "tool_use" && block.name === ANSWER_TOOL,
  );
}

/** The answer tool's input as a noul decision, or an error naming why the model gave no usable one. */
export function toVerdict(message: Message, label: string): Verdict {
  const call = answerCall(message);
  if (call === undefined) {
    throw new CliError(
      `the judge gave no verdict for ${label} (stop reason: ${message.stop_reason})`,
    );
  }
  return { ...parseAnswer(call.input, label), usage: toUsage(message.usage) };
}

/** SDK errors become one-line `CliError`s naming the provider; anything else is a bug. */
export function translateError(error: unknown, provider: string): never {
  if (error instanceof AnthropicError) {
    throw new CliError(`${provider}: ${error.message}`);
  }
  throw error;
}

/** The judge the Bedrock adapter wraps around its client's `create`. */
export function messagesJudge(create: CreateFn, model: string, provider: string): Judge {
  return {
    async judge(request) {
      const message = await create(buildRequest(request, model)).catch((error: unknown) =>
        translateError(error, provider),
      );
      return toVerdict(message, requestLabel(request));
    },
  };
}
