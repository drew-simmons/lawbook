import type { AutoParseableOutputFormat, ParsedMessage } from "@anthropic-ai/sdk";
import { AnthropicError } from "@anthropic-ai/sdk/error";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { CliError } from "../errors.ts";
import {
  type Answer,
  answerSchema,
  decisionSchema,
  type Judge,
  type JudgeRequest,
  type Verdict,
} from "./judge.ts";

export const SYSTEM_PROMPT = `You review one file against one written standard.

Give the probability, from 0 to 1, that the file meets the standard. Judge
only what the standard says: a file that has other problems still meets the
standard when the standard is met, and a file the standard does not apply to
meets it. Base the probability on the file alone.

Calibrate the number. 1 means the file plainly meets the standard and 0
means it plainly does not. 0.5 means the file gives no way to tell. Use
values in between when the evidence is mixed, and stay away from 0 and 1
unless the file leaves no doubt.

In the reason, cite the evidence in one or two sentences, quoting the
relevant line when that helps the reader find it.`;

/** A Messages API request whose answer parses into an `Answer`. */
export type AnswerParams = MessageCreateParamsNonStreaming & {
  output_config: { format: AutoParseableOutputFormat<Answer> };
};

/** `client.messages.parse` from any Anthropic SDK client. */
export type ParseFn = (params: AnswerParams) => Promise<ParsedMessage<Answer>>;

export function buildRequest(request: JudgeRequest, model: string): AnswerParams {
  return {
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Standard:\n${request.standard}\n\nFile: ${request.path}\n\n${request.content}`,
      },
    ],
    output_config: { format: zodOutputFormat(answerSchema) },
  };
}

/** The parsed answer as a noul decision, or an error naming why the model gave no usable one. */
export function toVerdict(message: ParsedMessage<Answer>, path: string): Verdict {
  const answer = message.parsed_output;
  if (answer === null) {
    throw new CliError(
      `the judge gave no verdict for ${path} (stop reason: ${message.stop_reason})`,
    );
  }
  const decision = decisionSchema.safeParse({ type: "noul", noul: answer.noul });
  if (!decision.success) {
    throw new CliError(`the judge gave an out-of-range probability ${answer.noul} for ${path}`);
  }
  return { decision: decision.data, reason: answer.reason };
}

/** SDK errors become one-line `CliError`s naming the provider; anything else is a bug. */
export function translateError(error: unknown, provider: string): never {
  if (error instanceof AnthropicError) {
    throw new CliError(`${provider}: ${error.message}`);
  }
  throw error;
}

/** The provider-neutral judge every adapter wraps around its own client. */
export function messagesJudge(parse: ParseFn, model: string, provider: string): Judge {
  return {
    async judge(request) {
      const message = await parse(buildRequest(request, model)).catch((error: unknown) =>
        translateError(error, provider),
      );
      return toVerdict(message, request.path);
    },
  };
}
