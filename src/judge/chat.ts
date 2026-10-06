import { OpenAIError } from "openai/error";
import { zodResponseFormat } from "openai/helpers/zod";
import type { AutoParseableResponseFormat } from "openai/lib/parser";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ParsedChatCompletion,
  ParsedChoice,
} from "openai/resources/chat/completions";
import type { CompletionUsage } from "openai/resources/completions";
import { CliError } from "../errors.ts";
import {
  type Answer,
  answerSchema,
  decisionOf,
  type Judge,
  type JudgeRequest,
  type Usage,
  type Verdict,
} from "./judge.ts";
import { exchangeJudge, fileBlocks, systemTexts } from "./messages.ts";
import {
  ANSWER_TOOL,
  ANSWER_TOOL_DESCRIPTION,
  ANSWER_TOOL_SCHEMA,
  TOOL_INSTRUCTION,
  toolArguments,
} from "./tool.ts";

/** A Chat Completions request whose answer parses into an `Answer`. */
export type ChatParams = ChatCompletionCreateParamsNonStreaming & {
  response_format: AutoParseableResponseFormat<Answer>;
};

/** `client.chat.completions.parse` from an OpenAI SDK client. */
export type ChatParseFn = (params: ChatParams) => Promise<ParsedChatCompletion<Answer>>;

/** `client.chat.completions.create` from an OpenAI SDK client, for the tool-call answer channel. */
export type ChatCreateFn = (
  params: ChatCompletionCreateParamsNonStreaming,
) => Promise<ChatCompletion>;

/** The system message, with any texts that follow the prompt, and the files as the user message. */
function chatMessages(request: JudgeRequest, after: string[]): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: [...systemTexts(request), ...after].join("\n\n") },
    { role: "user", content: fileBlocks(request.files) },
  ];
}

/**
 * The same prompt as the Messages API request, as one system message. OpenAI
 * caches shared prefixes on its own, so nothing marks the standard.
 */
export function buildChatRequest(request: JudgeRequest, model: string): ChatParams {
  return {
    model,
    max_completion_tokens: 1024,
    messages: chatMessages(request, []),
    response_format: zodResponseFormat(answerSchema, "answer"),
  };
}

/** The same request with the answer as a forced function call instead of a response format. */
export function buildChatToolRequest(
  request: JudgeRequest,
  model: string,
): ChatCompletionCreateParamsNonStreaming {
  return {
    model,
    max_completion_tokens: 1024,
    messages: chatMessages(request, [TOOL_INSTRUCTION]),
    tools: [
      {
        type: "function",
        function: {
          name: ANSWER_TOOL,
          description: ANSWER_TOOL_DESCRIPTION,
          parameters: ANSWER_TOOL_SCHEMA,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: ANSWER_TOOL } },
  };
}

/** OpenAI counts cached tokens inside `prompt_tokens`; lawbook reports them apart, like the other providers. */
export function toChatUsage(usage: CompletionUsage | undefined): Usage {
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: (usage?.prompt_tokens ?? 0) - cached,
    outputTokens: usage?.completion_tokens ?? 0,
    cacheReadInputTokens: cached,
    cacheCreationInputTokens: 0,
  };
}

/** Why a choice carries no answer: the model's refusal, else how it stopped. */
function noAnswer(choice: ParsedChoice<Answer> | undefined): string {
  return choice?.message.refusal ?? `finish reason: ${choice?.finish_reason ?? "none"}`;
}

/** The parsed answer as a noul decision, or an error naming why the model gave no usable one. */
export function toChatVerdict(completion: ParsedChatCompletion<Answer>, label: string): Verdict {
  const choice = completion.choices[0];
  const answer = choice?.message.parsed ?? null;
  if (answer === null) {
    throw new CliError(`the judge gave no verdict for ${label} (${noAnswer(choice)})`);
  }
  return {
    decision: decisionOf(answer.noul, label),
    reason: answer.reason,
    usage: toChatUsage(completion.usage),
  };
}

/**
 * The answer function's arguments as a noul decision. Text in the message,
 * such as the `<reasoning>` some open-weight models put there, is ignored.
 */
export function toChatToolVerdict(completion: ChatCompletion, label: string): Verdict {
  const choice = completion.choices[0];
  const call = choice?.message.tool_calls?.find(
    (tool) => tool.type === "function" && tool.function.name === ANSWER_TOOL,
  );
  if (call?.type !== "function") {
    throw new CliError(
      `the judge gave no verdict for ${label} (finish reason: ${choice?.finish_reason ?? "none"})`,
    );
  }
  return { ...toolArguments(call.function.arguments, label), usage: toChatUsage(completion.usage) };
}

/** SDK errors become one-line `CliError`s naming the provider; anything else is a bug. */
export function translateChatError(error: unknown, provider: string): never {
  if (error instanceof OpenAIError) {
    throw new CliError(`${provider}: ${error.message}`);
  }
  throw error;
}

/** The judge behind the OpenAI adapter, and any server that speaks Chat Completions. */
export function chatJudge(parse: ChatParseFn, model: string): Judge {
  return exchangeJudge(
    {
      build: buildChatRequest,
      send: parse,
      read: toChatVerdict,
      translate: (error) => translateChatError(error, "openai"),
    },
    model,
  );
}

/** The same judge for endpoints that take the answer only as a function call, such as Bedrock's. */
export function chatToolJudge(create: ChatCreateFn, model: string, provider: string): Judge {
  return exchangeJudge(
    {
      build: buildChatToolRequest,
      send: create,
      read: toChatToolVerdict,
      translate: (error) => translateChatError(error, provider),
    },
    model,
  );
}
