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
import type { Verdict } from "../src/judge/judge.ts";
import {
  messagesJudge,
  type ParseFn,
  SYSTEM_PROMPT,
  type VerdictParams,
} from "../src/judge/messages.ts";

const REQUEST = { standard: "Errors are actionable", path: "src/a.ts", content: "throw 1;\n" };

function message(parsed: Verdict | null, stopReason = "end_turn"): ParsedMessage<Verdict> {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "anthropic.claude-opus-5-5",
    content: [],
    stop_reason: stopReason as ParsedMessage<Verdict>["stop_reason"],
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
function stubParse(result: ParsedMessage<Verdict> | Error) {
  const calls: VerdictParams[] = [];
  const parse: ParseFn = async (params) => {
    calls.push(params);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { parse, calls };
}

test("messagesJudge sends the standard and file with the verdict format", async () => {
  const stub = stubParse(message({ pass: true, reason: "ok" }));
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
    required: ["pass", "reason"],
  });
});

test("messagesJudge returns the parsed verdict", async () => {
  const stub = stubParse(message({ pass: false, reason: "no next step" }));
  const verdict = await messagesJudge(stub.parse, "m", "bedrock").judge(REQUEST);
  expect(verdict).toEqual({ pass: false, reason: "no next step" });
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
