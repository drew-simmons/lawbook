import type { AutoParseableOutputFormat, ParsedMessage } from "@anthropic-ai/sdk";
import type { Message, TextBlockParam, ToolChoice } from "@anthropic-ai/sdk/resources/messages";
import { AnthropicError } from "@anthropic-ai/sdk/error";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { CliError } from "../errors.ts";
import type { SourceFile } from "../files.ts";
import {
  type Answer,
  answerSchema,
  decisionOf,
  type Judge,
  parseAnswer,
  type JudgeRequest,
  type Usage,
  type Verdict,
} from "./judge.ts";
import {
  ANSWER_TOOL,
  ANSWER_TOOL_DESCRIPTION,
  ANSWER_TOOL_SCHEMA,
  TOOL_INSTRUCTION,
} from "./tool.ts";

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

/** `client.messages.create` from any Anthropic SDK client, for the tool-call answer channel. */
export type CreateFn = (params: MessageCreateParamsNonStreaming) => Promise<Message>;

/** `File: <path>` and the content, one block per file, blank-line separated. */
export function fileBlocks(files: SourceFile[]): string {
  return files.map((file) => `File: ${file.path}\n\n${file.content}`).join("\n\n");
}

/** What messages call the request: the one file's path, or how many files there were. */
export function requestLabel(request: JudgeRequest): string {
  const paths = request.files.map((file) => file.path);
  return paths.length === 1 ? paths.join("") : `${paths.length} files`;
}

/** The reference files as one block the model reads but does not judge, or nothing. */
export function contextBlock(context: SourceFile[] | undefined): string[] {
  return context === undefined || context.length === 0
    ? []
    : [
        `Reference material. Use it to understand the standard; judge only the files in the message, not these.\n\n${fileBlocks(context)}`,
      ];
}

/** The system prompt, the standard, and any reference material: the same for every file in a rule. */
export function systemTexts(request: JudgeRequest): string[] {
  return [SYSTEM_PROMPT, `Standard:\n${request.standard}`, ...contextBlock(request.context)];
}

/** The texts as blocks, the last one marked so the provider caches the whole prefix. */
function withCacheControl(texts: string[]): TextBlockParam[] {
  return texts.map((text, index) =>
    index === texts.length - 1
      ? { type: "text", text, cache_control: { type: "ephemeral" } }
      : { type: "text", text },
  );
}

export function buildRequest(request: JudgeRequest, model: string): AnswerParams {
  return {
    model,
    max_tokens: 1024,
    system: withCacheControl(systemTexts(request)),
    messages: [{ role: "user", content: fileBlocks(request.files) }],
    output_config: { format: zodOutputFormat(answerSchema) },
  };
}

/**
 * Models that answer a forced `tool_choice` with a 400. They get `auto` and
 * rely on the tool instruction in the system prompt.
 */
export const UNFORCEABLE_MODELS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-fable-5-1",
  "claude-mythos-5-1",
];

/** Force the answer tool where the model allows it, else leave the choice to the model. */
export function toolChoice(model: string): ToolChoice {
  return UNFORCEABLE_MODELS.some((name) => model.includes(name))
    ? { type: "auto" }
    : { type: "tool", name: ANSWER_TOOL };
}

/**
 * The same request with the answer as a plain tool call instead of
 * structured output: the cached prefix as before, then the tool instruction.
 */
export function buildToolRequest(
  request: JudgeRequest,
  model: string,
): MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 1024,
    system: [...withCacheControl(systemTexts(request)), { type: "text", text: TOOL_INSTRUCTION }],
    messages: [{ role: "user", content: fileBlocks(request.files) }],
    tools: [
      {
        name: ANSWER_TOOL,
        description: ANSWER_TOOL_DESCRIPTION,
        input_schema: { type: "object", ...ANSWER_TOOL_SCHEMA },
      },
    ],
    tool_choice: toolChoice(model),
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

/** The parsed answer as a noul decision, or an error naming why the model gave no usable one. */
export function toVerdict(message: ParsedMessage<Answer>, path: string): Verdict {
  const answer = message.parsed_output;
  if (answer === null) {
    throw new CliError(
      `the judge gave no verdict for ${path} (stop reason: ${message.stop_reason})`,
    );
  }
  return {
    decision: decisionOf(answer.noul, path),
    reason: answer.reason,
    usage: toUsage(message.usage),
  };
}

/** The answer tool's input as a noul decision, or an error naming why there is none. */
export function toToolVerdict(message: Message, path: string): Verdict {
  const call = message.content.find(
    (block) => block.type === "tool_use" && block.name === ANSWER_TOOL,
  );
  if (call?.type !== "tool_use") {
    throw new CliError(
      `the judge gave no verdict for ${path} (stop reason: ${message.stop_reason})`,
    );
  }
  return { ...parseAnswer(call.input, path), usage: toUsage(message.usage) };
}

/** SDK errors become one-line `CliError`s naming the provider; anything else is a bug. */
export function translateError(error: unknown, provider: string): never {
  if (error instanceof AnthropicError) {
    throw new CliError(`${provider}: ${error.message}`);
  }
  throw error;
}

/** How one answer channel builds its request, sends it, reads the reply, and names its errors. */
export interface Exchange<Params, Reply> {
  build(request: JudgeRequest, model: string): Params;
  send(params: Params): Promise<Reply>;
  read(reply: Reply, label: string): Verdict;
  translate(error: unknown): never;
}

/** A judge over any answer channel: the Messages and Chat Completions judges are all this. */
export function exchangeJudge<Params, Reply>(
  exchange: Exchange<Params, Reply>,
  model: string,
): Judge {
  return {
    async judge(request) {
      const reply = await exchange
        .send(exchange.build(request, model))
        .catch((error: unknown) => exchange.translate(error));
      return exchange.read(reply, requestLabel(request));
    },
  };
}

/** The provider-neutral judge every adapter wraps around its own client. */
export function messagesJudge(parse: ParseFn, model: string, provider: string): Judge {
  return exchangeJudge(
    {
      build: buildRequest,
      send: parse,
      read: toVerdict,
      translate: (error) => translateError(error, provider),
    },
    model,
  );
}

/** The same judge for endpoints that take the answer only as a tool call, such as Bedrock's. */
export function messagesToolJudge(create: CreateFn, model: string, provider: string): Judge {
  return exchangeJudge(
    {
      build: buildToolRequest,
      send: create,
      read: toToolVerdict,
      translate: (error) => translateError(error, provider),
    },
    model,
  );
}
