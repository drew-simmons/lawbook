import type { AutoParseableOutputFormat, ParsedMessage } from "@anthropic-ai/sdk";
import { AnthropicError } from "@anthropic-ai/sdk/error";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { CliError } from "../errors.ts";
import type { SourceFile } from "../files.ts";
import {
  type Answer,
  answerSchema,
  decisionSchema,
  type Judge,
  type JudgeRequest,
  type Usage,
  type Verdict,
} from "./judge.ts";

export const SYSTEM_PROMPT = `You review one or more files against one written standard.

Give the probability, from 0 to 1, that the files meet the standard. Judge
only what the standard says: a file that has other problems still meets the
standard when the standard is met, and a file the standard does not apply to
meets it. Base the probability on the files alone. When several files are
given, judge whether they meet the standard together.

Calibrate the number. 1 means the files plainly meet the standard and 0
means they plainly do not. 0.5 means the files give no way to tell. Use
values in between when the evidence is mixed, and stay away from 0 and 1
unless the files leave no doubt.

In the reason, cite the evidence in one or two sentences, naming the file
and quoting the relevant line when that helps the reader find it.`;

/** A Messages API request whose answer parses into an `Answer`. */
export type AnswerParams = MessageCreateParamsNonStreaming & {
  output_config: { format: AutoParseableOutputFormat<Answer> };
};

/** `client.messages.parse` from any Anthropic SDK client. */
export type ParseFn = (params: AnswerParams) => Promise<ParsedMessage<Answer>>;

/** `File: <path>` and the content, one block per file, blank-line separated. */
function fileBlocks(files: SourceFile[]): string {
  return files.map((file) => `File: ${file.path}\n\n${file.content}`).join("\n\n");
}

/** What messages call the request: the one file's path, or how many files there were. */
export function requestLabel(request: JudgeRequest): string {
  const paths = request.files.map((file) => file.path);
  return paths.length === 1 ? paths.join("") : `${paths.length} files`;
}

export function buildRequest(request: JudgeRequest, model: string): AnswerParams {
  return {
    model,
    max_tokens: 1024,
    // The standard is the same for every file in a rule, so the provider caches it.
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      {
        type: "text",
        text: `Standard:\n${request.standard}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: fileBlocks(request.files) }],
    output_config: { format: zodOutputFormat(answerSchema) },
  };
}

/** The provider's counts in lawbook's names; a provider without a cache reports null. */
export function toUsage(usage: ParsedMessage<Answer>["usage"]): Usage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
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
  return { decision: decision.data, reason: answer.reason, usage: toUsage(message.usage) };
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
      return toVerdict(message, requestLabel(request));
    },
  };
}
