import { OpenAIError } from "openai/error";
import { zodResponseFormat } from "openai/helpers/zod";
import type { AutoParseableResponseFormat } from "openai/lib/parser";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ParsedChatCompletion,
  ParsedChoice,
} from "openai/resources/chat/completions";
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
import { fileBlocks, requestLabel, systemTexts } from "./prompt.ts";

/** A Chat Completions request whose answer parses into an `Answer`. */
export type ChatParams = ChatCompletionCreateParamsNonStreaming & {
  response_format: AutoParseableResponseFormat<Answer>;
};

/** `client.chat.completions.parse` from an OpenAI SDK client. */
export type ChatParseFn = (params: ChatParams) => Promise<ParsedChatCompletion<Answer>>;

/**
 * The usage a Chat Completions server reports. OpenAI puts the tokens it
 * read from its cache in `cached_tokens`; Bifrost reports reads and writes
 * apart as `cached_read_tokens` and `cached_write_tokens`.
 */
export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cached_read_tokens?: number;
    cached_write_tokens?: number;
  } | null;
}

/**
 * The same prompt as every provider gets, as one system message. The
 * standard is the stable prefix, so a server that caches prefixes, on its
 * own or through Bifrost's `auto_inject`, caches the whole system message.
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

/** Servers count cached tokens inside `prompt_tokens`; lawbook reports them apart, like the CLI providers. */
export function toChatUsage(usage: ChatUsage | undefined): Usage {
  const details = usage?.prompt_tokens_details;
  const read = details?.cached_read_tokens ?? details?.cached_tokens ?? 0;
  const written = details?.cached_write_tokens ?? 0;
  return {
    inputTokens: (usage?.prompt_tokens ?? 0) - read - written,
    outputTokens: usage?.completion_tokens ?? 0,
    cacheReadInputTokens: read,
    cacheCreationInputTokens: written,
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
export function translateChatError(error: unknown, provider: string): never {
  if (error instanceof OpenAIError) {
    throw new CliError(`${provider}: ${error.message}`);
  }
  throw error;
}

/** The judge behind the Bifrost and OpenAI adapters: any server that speaks Chat Completions. */
export function chatJudge(parse: ChatParseFn, model: string, provider: string): Judge {
  return {
    async judge(request) {
      const completion = await parse(buildChatRequest(request, model)).catch((error: unknown) =>
        translateChatError(error, provider),
      );
      return toChatVerdict(completion, requestLabel(request));
    },
  };
}
