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
  buildRequest,
  messagesJudge,
  type ParseFn,
  requestLabel,
  SYSTEM_PROMPT,
} from "../src/judge/messages.ts";

const REQUEST = {
  standard: "Errors are actionable",
  files: [{ path: "src/a.ts", content: "throw 1;\n" }],
};

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

test("buildRequest joins several files into blank-line separated blocks", async () => {
  const stub = stubParse(message({ noul: 0.9, reason: "ok" }));
  const request = {
    standard: "s",
    files: [
      { path: "a.ts", content: "1;\n" },
      { path: "b.ts", content: "2;\n" },
    ],
  };
  await messagesJudge(stub.parse, "m", "bedrock").judge(request);
  expect(stub.calls[0]?.messages).toEqual([
    { role: "user", content: "File: a.ts\n\n1;\n\n\nFile: b.ts\n\n2;\n" },
  ]);
});

test("requestLabel names one file by path and several by count", () => {
  expect(requestLabel(REQUEST)).toBe("src/a.ts");
  expect(
    requestLabel({
      standard: "s",
      files: [
        { path: "a", content: "" },
        { path: "b", content: "" },
      ],
    }),
  ).toBe("2 files");
});

test("a verdictless answer for a set names the file count", async () => {
  const stub = stubParse(message(null, "max_tokens"));
  const request = {
    standard: "s",
    files: [
      { path: "a", content: "" },
      { path: "b", content: "" },
    ],
  };
  await expect(messagesJudge(stub.parse, "m", "bedrock").judge(request)).rejects.toThrow(
    "the judge gave no verdict for 2 files (stop reason: max_tokens)",
  );
});

test("buildRequest puts the cache marker on the context block when there is one", () => {
  const params = buildRequest(
    { ...REQUEST, context: [{ path: "docs/style.md", content: "# Style\n" }] },
    "m",
  );
  expect(params.system).toEqual([
    { type: "text", text: SYSTEM_PROMPT },
    { type: "text", text: "Standard:\nErrors are actionable" },
    {
      type: "text",
      text: "Reference material. Use it to understand the standard; judge only the files in the message, not these.\n\nFile: docs/style.md\n\n# Style\n",
      cache_control: { type: "ephemeral" },
    },
  ]);
});

test("buildRequest treats an empty context like none", () => {
  expect(buildRequest({ ...REQUEST, context: [] }, "m").system).toHaveLength(2);
});
