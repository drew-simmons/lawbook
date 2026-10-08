import {
  APIConnectionError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from "@anthropic-ai/sdk/error";
import type {
  ContentBlock,
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages";
import { expect, test } from "vitest";
import { CliError } from "../src/errors.ts";
import { bedrockRegion, undatedModelId, unknownModel } from "../src/judge/bedrock.ts";
import { decisionSchema } from "../src/judge/judge.ts";
import {
  buildRequest,
  type CreateFn,
  MAX_TOKENS,
  messagesJudge,
  TOOL_INSTRUCTION,
} from "../src/judge/messages.ts";
import { requestLabel, SYSTEM_PROMPT } from "../src/judge/prompt.ts";

const REQUEST = {
  standard: "Errors are actionable",
  files: [{ path: "src/a.ts", content: "throw 1;\n" }],
};

const SET_REQUEST = {
  standard: "s",
  files: [
    { path: "a", content: "" },
    { path: "b", content: "" },
  ],
};

/** A call to the answer tool with `input`, as the model makes it. */
function answerCall(input: unknown, name = "answer"): ContentBlock {
  return { type: "tool_use", id: "toolu_1", name, input, caller: { type: "direct" } };
}

function message(content: ContentBlock[], stopReason = "tool_use"): Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "anthropic.claude-haiku-4-5",
    content,
    stop_reason: stopReason as Message["stop_reason"],
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
  };
}

/** A `create` that records its params and answers with `result`. */
function stubCreate(result: Message | Error) {
  const calls: MessageCreateParamsNonStreaming[] = [];
  const create: CreateFn = async (params) => {
    calls.push(params);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { create, calls };
}

test("messagesJudge sends the standard and file with one answer tool the model may call", async () => {
  const stub = stubCreate(message([answerCall({ noul: 0.9, reason: "ok" })]));
  await messagesJudge(stub.create, "anthropic.claude-haiku-4-5", "bedrock").judge(REQUEST);
  expect(stub.calls).toHaveLength(1);
  const [params] = stub.calls;
  expect(params?.model).toBe("anthropic.claude-haiku-4-5");
  expect(params?.max_tokens).toBe(MAX_TOKENS);
  expect(params?.system).toEqual([
    { type: "text", text: SYSTEM_PROMPT },
    {
      type: "text",
      text: "Standard:\nErrors are actionable",
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: TOOL_INSTRUCTION },
  ]);
  expect(params?.messages).toEqual([{ role: "user", content: "File: src/a.ts\n\nthrow 1;\n" }]);
  expect(params?.tools).toHaveLength(1);
  expect(params?.tools?.[0]).toMatchObject({
    name: "answer",
    input_schema: {
      type: "object",
      required: ["noul", "reason"],
      properties: { noul: { type: "number" }, reason: { type: "string" } },
      additionalProperties: false,
    },
  });
  expect(params?.tools?.[0]).not.toHaveProperty("strict");
  expect(params?.tool_choice).toEqual({ type: "auto" });
  expect(params).not.toHaveProperty("output_config");
  expect(params).not.toHaveProperty("thinking");
});

test("messagesJudge returns the tool input as a noul decision with its reason", async () => {
  const stub = stubCreate(message([answerCall({ noul: 0.2, reason: "no next step" })]));
  const verdict = await messagesJudge(stub.create, "m", "bedrock").judge(REQUEST);
  expect(verdict).toMatchObject({ decision: { type: "noul", noul: 0.2 }, reason: "no next step" });
});

test("text the model writes before the call is ignored", async () => {
  const stub = stubCreate(
    message([
      { type: "text", text: "Let me look.", citations: null },
      answerCall({ noul: 0.7, reason: "mostly" }),
    ]),
  );
  const verdict = await messagesJudge(stub.create, "m", "bedrock").judge(REQUEST);
  expect(verdict.reason).toBe("mostly");
});

test("decisionSchema is a Jev noul with a probability within 0 and 1", () => {
  expect(decisionSchema.parse({ type: "noul", noul: 0.98 })).toEqual({ type: "noul", noul: 0.98 });
  expect(decisionSchema.safeParse({ type: "noul", noul: 1.2 }).success).toBe(false);
  expect(decisionSchema.safeParse({ type: "noul", noul: -0.1 }).success).toBe(false);
  expect(decisionSchema.safeParse({ type: "choice", choice: "x" }).success).toBe(false);
});

test("an answer in text instead of a call is a CliError naming the stop reason", async () => {
  const stub = stubCreate(
    message([{ type: "text", text: "Looks fine.", citations: null }], "end_turn"),
  );
  await expect(messagesJudge(stub.create, "m", "bedrock").judge(REQUEST)).rejects.toThrow(
    new CliError("the judge gave no verdict for src/a.ts (stop reason: end_turn)"),
  );
});

test("a run that stops before the call is a CliError naming the stop reason", async () => {
  const stub = stubCreate(message([], "max_tokens"));
  await expect(messagesJudge(stub.create, "m", "bedrock").judge(REQUEST)).rejects.toThrow(
    new CliError("the judge gave no verdict for src/a.ts (stop reason: max_tokens)"),
  );
});

test("a call to some other tool is not an answer", async () => {
  const stub = stubCreate(message([answerCall({ noul: 0.5, reason: "r" }, "other")]));
  await expect(messagesJudge(stub.create, "m", "bedrock").judge(REQUEST)).rejects.toThrow(
    "the judge gave no verdict for src/a.ts (stop reason: tool_use)",
  );
});

test("a call whose input is not an answer is a CliError naming what is missing", async () => {
  const stub = stubCreate(message([answerCall({ reason: "r" })]));
  await expect(messagesJudge(stub.create, "m", "bedrock").judge(REQUEST)).rejects.toThrow(
    /^the judge gave no verdict for src\/a\.ts \(.*noul/,
  );
});

const headers = new Headers();

test.each([
  ["AuthenticationError", new AuthenticationError(401, undefined, "invalid x-api-key", headers)],
  ["NotFoundError", new NotFoundError(404, undefined, "model: nope", headers)],
  ["RateLimitError", new RateLimitError(429, undefined, "rate limited", headers)],
  ["APIConnectionError", new APIConnectionError({ message: "Connection error." })],
])("%s becomes a CliError naming the provider", async (_name, error) => {
  const stub = stubCreate(error);
  const failure = messagesJudge(stub.create, "m", "bedrock").judge(REQUEST);
  await expect(failure).rejects.toBeInstanceOf(CliError);
  await expect(failure).rejects.toThrow(`bedrock: ${error.message}`);
});

test("other errors propagate unchanged", async () => {
  const error = new TypeError("boom");
  const stub = stubCreate(error);
  await expect(messagesJudge(stub.create, "m", "bedrock").judge(REQUEST)).rejects.toBe(error);
});

test.each([
  ["us.anthropic.claude-haiku-4-5-20251001-v1:0", "anthropic.claude-haiku-4-5"],
  ["global.anthropic.claude-opus-5-5", "anthropic.claude-opus-5-5"],
  ["anthropic.claude-opus-4-6-v1", "anthropic.claude-opus-4-6"],
  ["anthropic.claude-sonnet-5", "anthropic.claude-sonnet-5"],
])("undatedModelId(%s) is %s", (model, undated) => {
  expect(undatedModelId(model)).toBe(undated);
});

const notFound = new NotFoundError(404, undefined, "The model does not exist", headers);

test("unknownModel turns the endpoint's 404 for a dated id into the undated form", () => {
  const dated = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
  expect(() => unknownModel(dated, "us-east-1")(notFound)).toThrow(CliError);
  expect(() => unknownModel(dated, "us-east-1")(notFound)).toThrow(
    `bedrock: the Bedrock Messages endpoint in us-east-1 does not know the model id ${dated}; name it in the undated anthropic.<model> form, anthropic.claude-haiku-4-5`,
  );
});

test("unknownModel turns the 404 for an undated id into a model the endpoint serves", () => {
  expect(() => unknownModel("anthropic.claude-haiku-5-5", "us-west-2")(notFound)).toThrow(
    "bedrock: the Bedrock Messages endpoint in us-west-2 does not know the model id anthropic.claude-haiku-5-5; it serves only some of the models Bedrock lists; name one it serves, such as anthropic.claude-haiku-4-5",
  );
});

test("unknownModel passes every other error on unchanged", () => {
  const denied = new AuthenticationError(401, undefined, "denied", headers);
  expect(() => unknownModel("m", "r")(denied)).toThrow(denied);
  const bug = new TypeError("boom");
  expect(() => unknownModel("m", "r")(bug)).toThrow(bug);
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
  const stub = stubCreate(message([answerCall({ noul, reason: "x" })]));
  const failure = messagesJudge(stub.create, "m", "bedrock").judge(REQUEST);
  await expect(failure).rejects.toThrow(CliError);
  await expect(failure).rejects.toThrow(
    `the judge gave an out-of-range probability ${noul} for src/a.ts`,
  );
});

test("messagesJudge reports usage with the provider's nulls as zero", async () => {
  const stub = stubCreate(message([answerCall({ noul: 0.9, reason: "ok" })]));
  const verdict = await messagesJudge(stub.create, "m", "bedrock").judge(REQUEST);
  expect(verdict.usage).toEqual({
    inputTokens: 1,
    outputTokens: 1,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
  expect(verdict.cached).toBeUndefined();
});

test("messagesJudge carries the provider's cache token counts", async () => {
  const full = message([answerCall({ noul: 0.9, reason: "ok" })]);
  full.usage = { ...full.usage, cache_read_input_tokens: 900, cache_creation_input_tokens: 30 };
  const stub = stubCreate(full);
  const verdict = await messagesJudge(stub.create, "m", "bedrock").judge(REQUEST);
  expect(verdict.usage).toMatchObject({ cacheReadInputTokens: 900, cacheCreationInputTokens: 30 });
});

test("buildRequest joins several files into blank-line separated blocks", async () => {
  const stub = stubCreate(message([answerCall({ noul: 0.9, reason: "ok" })]));
  const request = {
    standard: "s",
    files: [
      { path: "a.ts", content: "1;\n" },
      { path: "b.ts", content: "2;\n" },
    ],
  };
  await messagesJudge(stub.create, "m", "bedrock").judge(request);
  expect(stub.calls[0]?.messages).toEqual([
    { role: "user", content: "File: a.ts\n\n1;\n\n\nFile: b.ts\n\n2;\n" },
  ]);
});

test("requestLabel names one file by path and several by count", () => {
  expect(requestLabel(REQUEST)).toBe("src/a.ts");
  expect(requestLabel(SET_REQUEST)).toBe("2 files");
});

test("a verdictless answer for a set names the file count", async () => {
  const stub = stubCreate(message([], "max_tokens"));
  await expect(messagesJudge(stub.create, "m", "bedrock").judge(SET_REQUEST)).rejects.toThrow(
    "the judge gave no verdict for 2 files (stop reason: max_tokens)",
  );
});

test("buildRequest puts the cache marker on the context block, then the instruction", () => {
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
    { type: "text", text: TOOL_INSTRUCTION },
  ]);
});

test("buildRequest treats an empty context like none", () => {
  expect(buildRequest({ ...REQUEST, context: [] }, "m").system).toHaveLength(3);
});
