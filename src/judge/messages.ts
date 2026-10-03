import type { AutoParseableOutputFormat, ParsedMessage } from "@anthropic-ai/sdk";
import { AnthropicError } from "@anthropic-ai/sdk/error";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { CliError } from "../errors.ts";
import { type Judge, type JudgeRequest, type Verdict, verdictSchema } from "./judge.ts";

export const SYSTEM_PROMPT = `You review one file against one written standard.

Decide whether the file meets the standard. Judge only what the standard
says: a file that has other problems still passes when the standard is met,
and a file the standard does not apply to passes. Base the verdict on the
file alone. In the reason, cite the evidence in one or two sentences, quoting
the relevant line when that helps the reader find it.`;

/** A Messages API request whose answer parses into a `Verdict`. */
export type VerdictParams = MessageCreateParamsNonStreaming & {
  output_config: { format: AutoParseableOutputFormat<Verdict> };
};

/** `client.messages.parse` from any Anthropic SDK client. */
export type ParseFn = (params: VerdictParams) => Promise<ParsedMessage<Verdict>>;

export function buildRequest(request: JudgeRequest, model: string): VerdictParams {
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
    output_config: { format: zodOutputFormat(verdictSchema) },
  };
}

/** The parsed verdict, or an error naming why the model gave none. */
export function toVerdict(message: ParsedMessage<Verdict>, path: string): Verdict {
  if (message.parsed_output === null) {
    throw new CliError(
      `the judge gave no verdict for ${path} (stop reason: ${message.stop_reason})`,
    );
  }
  return message.parsed_output;
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
