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
import { type Answer, decisionSchema, noulDecisionSchema } from "../src/judge/judge.ts";
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
  expect(params?.system).toBe(SYSTEM_PROMPT);
  expect(params?.messages).toEqual([
    {
      role: "user",
      content: "Standard:\nErrors are actionable\n\nFile: src/a.ts\n\nthrow 1;\n",
    },
  ]);
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
  expect(verdict).toEqual({ decision: { type: "noul", noul: 0.2 }, reason: "no next step" });
});

test("decisionSchema accepts every Jev answer shape", () => {
  expect(decisionSchema.parse({ type: "noul", noul: 0.98 })).toEqual({ type: "noul", noul: 0.98 });
  const choice = {
    type: "choice",
    choice: "billing",
    probabilities: { billing: 0.88, technical: 0.12, sales: 0 },
    confidence: 0.81,
  };
  expect(decisionSchema.parse(choice)).toEqual(choice);
  const score = {
    type: "score",
    score: 1.05,
    legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
    probabilities: { "0": 0, "1": 0.95, "2": 0.05 },
    confidence: 0.92,
  };
  expect(decisionSchema.parse(score)).toEqual(score);
});

test("a noul decision stays within 0 and 1", () => {
  expect(noulDecisionSchema.safeParse({ type: "noul", noul: 1.2 }).success).toBe(false);
  expect(noulDecisionSchema.safeParse({ type: "noul", noul: -0.1 }).success).toBe(false);
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
  const llm = { provider: "bedrock" as const, model: "m", region: "eu-central-1" };
  expect(bedrockRegion(llm, { AWS_REGION: "us-east-1" })).toBe("eu-central-1");
});

test("bedrockRegion falls back to AWS_REGION then AWS_DEFAULT_REGION", () => {
  const llm = { provider: "bedrock" as const, model: "m" };
  expect(bedrockRegion(llm, { AWS_REGION: "us-east-1", AWS_DEFAULT_REGION: "us-west-2" })).toBe(
    "us-east-1",
  );
  expect(bedrockRegion(llm, { AWS_DEFAULT_REGION: "us-west-2" })).toBe("us-west-2");
});

test("bedrockRegion without any region is a CliError", () => {
  const llm = { provider: "bedrock" as const, model: "m" };
  expect(() => bedrockRegion(llm, {})).toThrow(CliError);
  expect(() => bedrockRegion(llm, {})).toThrow("set llm.region");
});
