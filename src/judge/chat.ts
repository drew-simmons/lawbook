import { OpenAIError } from "openai/error";
import { zodResponseFormat } from "openai/helpers/zod";
import type { AutoParseableResponseFormat } from "openai/lib/parser";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ParsedChatCompletion,
  ParsedChoice,
} from "openai/resources/chat/completions";
import type { CompletionUsage } from "openai/resources/completions";
import { CliError } from "../errors.ts";
import {
  type Answer,
  answerSchema,
  type Judge,
  type JudgeRequest,
  type Usage,
  type Verdict,
} from "./judge.ts";
import { decisionOf, fileBlocks, requestLabel, systemTexts } from "./messages.ts";

/** A Chat Completions request whose answer parses into an `Answer`. */
export type ChatParams = ChatCompletionCreateParamsNonStreaming & {
  response_format: AutoParseableResponseFormat<Answer>;
};

/** `client.chat.completions.parse` from an OpenAI SDK client. */
export type ChatParseFn = (params: ChatParams) => Promise<ParsedChatCompletion<Answer>>;

/**
 * The same prompt as the Messages API request, as one system message. OpenAI
 * caches shared prefixes on its own, so nothing marks the standard.
 */
export function buildChatRequest(request: JudgeRequest, model: string): ChatParams {
  return {
    model,
    max_completion_tokens: 1024,
    messages: [
      { role: "system", content: systemTexts(request).join("\n\n") },
      { role: "user", content: fileBlocks(request.files) },
    ],
    response_format: zodResponseFormat(answerSchema, "answer"),
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

/** SDK errors become one-line `CliError`s naming the provider; anything else is a bug. */
export function translateChatError(error: unknown): never {
  if (error instanceof OpenAIError) {
    throw new CliError(`openai: ${error.message}`);
  }
  throw error;
}

/** The judge behind the OpenAI adapter, and any server that speaks Chat Completions. */
export function chatJudge(parse: ChatParseFn, model: string): Judge {
  return {
    async judge(request) {
      const completion = await parse(buildChatRequest(request, model)).catch(translateChatError);
      return toChatVerdict(completion, requestLabel(request));
    },
  };
}
