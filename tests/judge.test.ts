import type { ParsedMessage } from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from "@anthropic-ai/sdk/error";
import { expect, test } from "vitest";
import { CliError } from "../src/errors.ts";
import { bedrockRegion } from "../src/judge/bedrock.ts";
import { type Answer, decisionSchema } from "../src/judge/judge.ts";
import {
  type AnswerParams,
  messagesJudge,
  type ParseFn,
  SYSTEM_PROMPT,
} from "../src/judge/messages.ts";

const REQUEST = { standard: "Errors are actionable", path: "src/a.ts", content: "throw 1;\n" };

function message(parsed: Answer | null, stopReason = "end_turn"): ParsedMessage<Answer> {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "anthropic.claude-opus-5-5",
    content: [],
    stop_reason: stopReason as ParsedMessage<Answer>["stop_reason"],
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      output_tokens_details: null,
    },
    container: null,
    diagnostics: null,
    parsed_output: parsed,
  };
}

/** A `parse` that records its params and answers with `result`. */
function stubParse(result: ParsedMessage<Answer> | Error) {
  const calls: AnswerParams[] = [];
  const parse: ParseFn = async (params) => {
    calls.push(params);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { parse, calls };
}

test("messagesJudge sends the standard and file with the answer format", async () => {
  const stub = stubParse(message({ noul: 0.9, reason: "ok" }));
  await messagesJudge(stub.parse, "anthropic.claude-opus-5-5", "bedrock").judge(REQUEST);
  expect(stub.calls).toHaveLength(1);
  const [params] = stub.calls;
  expect(params?.model).toBe("anthropic.claude-opus-5-5");
  expect(params?.max_tokens).toBe(1024);
  expect(params?.system).toEqual([
    { type: "text", text: SYSTEM_PROMPT },
    {
      type: "text",
      text: "Standard:\nErrors are actionable",
      cache_control: { type: "ephemeral" },
    },
  ]);
  expect(params?.messages).toEqual([{ role: "user", content: "File: src/a.ts\n\nthrow 1;\n" }]);
  expect(params?.output_config.format.type).toBe("json_schema");
  expect(params?.output_config.format.schema).toMatchObject({
    type: "object",
    required: ["noul", "reason"],
    properties: { noul: { type: "number" }, reason: { type: "string" } },
  });
});

test("messagesJudge returns the answer as a noul decision with its reason", async () => {
  const stub = stubParse(message({ noul: 0.2, reason: "no next step" }));
  const verdict = await messagesJudge(stub.parse, "m", "bedrock").judge(REQUEST);
  expect(verdict).toMatchObject({ decision: { type: "noul", noul: 0.2 }, reason: "no next step" });
});

test("decisionSchema is a Jev noul with a probability within 0 and 1", () => {
  expect(decisionSchema.parse({ type: "noul", noul: 0.98 })).toEqual({ type: "noul", noul: 0.98 });
  expect(decisionSchema.safeParse({ type: "noul", noul: 1.2 }).success).toBe(false);
  expect(decisionSchema.safeParse({ type: "noul", noul: -0.1 }).success).toBe(false);
  expect(decisionSchema.safeParse({ type: "choice", choice: "x" }).success).toBe(false);
});

test("a missing verdict becomes a CliError naming the stop reason", async () => {
  const stub = stubParse(message(null, "max_tokens"));
  await expect(messagesJudge(stub.parse, "m", "bedrock").judge(REQUEST)).rejects.toThrow(
    new CliError("the judge gave no verdict for src/a.ts (stop reason: max_tokens)"),
  );
});

const headers = new Headers();

test.each([
  ["AuthenticationError", new AuthenticationError(401, undefined, "invalid x-api-key", headers)],
  ["NotFoundError", new NotFoundError(404, undefined, "model: nope", headers)],
  ["RateLimitError", new RateLimitError(429, undefined, "rate limited", headers)],
  ["APIConnectionError", new APIConnectionError({ message: "Connection error." })],
])("%s becomes a CliError naming the provider", async (_name, error) => {
  const stub = stubParse(error);
  const failure = messagesJudge(stub.parse, "m", "anthropic").judge(REQUEST);
  await expect(failure).rejects.toBeInstanceOf(CliError);
  await expect(failure).rejects.toThrow(`anthropic: ${error.message}`);
});

test("other errors propagate unchanged", async () => {
  const error = new TypeError("boom");
  const stub = stubParse(error);
  await expect(messagesJudge(stub.parse, "m", "bedrock").judge(REQUEST)).rejects.toBe(error);
});

test("bedrockRegion prefers the config", () => {
  const llm = {
    provider: "bedrock" as const,
    model: "m",
    region: "eu-central-1",
    concurrency: 4,
    maxBytes: 131072,
    cache: true,
  };
  expect(bedrockRegion(llm, { AWS_REGION: "us-east-1" })).toBe("eu-central-1");
});

test("bedrockRegion falls back to AWS_REGION then AWS_DEFAULT_REGION", () => {
  const llm = {
    provider: "bedrock" as const,
    model: "m",
    concurrency: 4,
    maxBytes: 131072,
    cache: true,
  };
  expect(bedrockRegion(llm, { AWS_REGION: "us-east-1", AWS_DEFAULT_REGION: "us-west-2" })).toBe(
    "us-east-1",
  );
  expect(bedrockRegion(llm, { AWS_DEFAULT_REGION: "us-west-2" })).toBe("us-west-2");
});

test("bedrockRegion without any region is a CliError", () => {
  const llm = {
    provider: "bedrock" as const,
    model: "m",
    concurrency: 4,
    maxBytes: 131072,
    cache: true,
  };
  expect(() => bedrockRegion(llm, {})).toThrow(CliError);
  expect(() => bedrockRegion(llm, {})).toThrow("set llm.region");
});

test.each([1.5, -0.1])("a probability of %s is a CliError naming the file", async (noul) => {
  const stub = stubParse(message({ noul, reason: "x" }));
  const failure = messagesJudge(stub.parse, "m", "bedrock").judge(REQUEST);
  await expect(failure).rejects.toThrow(CliError);
  await expect(failure).rejects.toThrow(
    `the judge gave an out-of-range probability ${noul} for src/a.ts`,
  );
});

test("messagesJudge reports usage with the provider's nulls as zero", async () => {
  const stub = stubParse(message({ noul: 0.9, reason: "ok" }));
  const verdict = await messagesJudge(stub.parse, "m", "bedrock").judge(REQUEST);
  expect(verdict.usage).toEqual({
    inputTokens: 1,
    outputTokens: 1,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
  expect(verdict.cached).toBeUndefined();
});

test("messagesJudge carries the provider's cache token counts", async () => {
  const full = message({ noul: 0.9, reason: "ok" });
  full.usage = { ...full.usage, cache_read_input_tokens: 900, cache_creation_input_tokens: 30 };
  const stub = stubParse(full);
  const verdict = await messagesJudge(stub.parse, "m", "bedrock").judge(REQUEST);
  expect(verdict.usage).toMatchObject({ cacheReadInputTokens: 900, cacheCreationInputTokens: 30 });
});
