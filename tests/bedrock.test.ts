import type { Message } from "@anthropic-ai/sdk/resources/messages";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { afterEach, expect, test, vi } from "vitest";
import { CliError } from "../src/errors.ts";
import {
  bedrockChatJudge,
  bedrockJudge,
  bedrockMessagesJudge,
  bedrockRoute,
  undatedModelId,
} from "../src/judge/bedrock.ts";
import { chatToolJudge, type ChatCreateFn } from "../src/judge/chat.ts";
import { type CreateFn, messagesToolJudge, SYSTEM_PROMPT } from "../src/judge/messages.ts";
import { ANSWER_TOOL_SCHEMA, TOOL_INSTRUCTION } from "../src/judge/tool.ts";

const REQUEST = {
  standard: "Errors are actionable",
  files: [{ path: "src/a.ts", content: "throw 1;\n" }],
};

const LLM = {
  provider: "bedrock" as const,
  concurrency: 4,
  maxBytes: 131072,
  cache: true,
  region: "us-east-1",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function message(content: Message["content"], stopReason: Message["stop_reason"] = "tool_use") {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "anthropic.claude-haiku-4-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 7, output_tokens: 3 },
  } as Message;
}

function toolUse(input: unknown, name = "answer") {
  return { type: "tool_use", id: "toolu_1", name, input } as Message["content"][number];
}

function stubCreate(result: Message) {
  const calls: MessageCreateParamsNonStreaming[] = [];
  const create: CreateFn = async (params) => {
    calls.push(params);
    return result;
  };
  return { create, calls };
}

function completion(content: string | null, calls: { name: string; arguments: string }[]) {
  return {
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 0,
    model: "openai.gpt-oss-120b-1:0",
    choices: [
      {
        index: 0,
        finish_reason: calls.length === 0 ? "stop" : "tool_calls",
        logprobs: null,
        message: {
          role: "assistant",
          content,
          refusal: null,
          tool_calls: calls.map((fn, index) => ({
            id: `call_${index}`,
            type: "function",
            function: fn,
          })),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  } as ChatCompletion;
}

function stubChat(result: ChatCompletion) {
  const calls: ChatCompletionCreateParamsNonStreaming[] = [];
  const create: ChatCreateFn = async (params) => {
    calls.push(params);
    return result;
  };
  return { create, calls };
}

const ANSWER = JSON.stringify({ noul: 0.8, reason: "names the fix" });

test.each([
  ["anthropic.claude-haiku-4-5", bedrockMessagesJudge],
  ["anthropic.claude-opus-5-5", bedrockMessagesJudge],
  ["us.anthropic.claude-haiku-4-5-20251001-v1:0", bedrockMessagesJudge],
  ["openai.gpt-oss-120b-1:0", bedrockChatJudge],
  ["openai.gpt-5.5", bedrockChatJudge],
  ["us.openai.gpt-5.5", bedrockChatJudge],
  ["global.openai.gpt-5.5", bedrockChatJudge],
])("bedrockRoute sends %s to its endpoint", (model, route) => {
  expect(bedrockRoute(model)).toBe(route);
});

test.each(["meta.llama4-maverick-17b-instruct-v1:0", "us.amazon.nova-pro-v1:0", "constructor"])(
  "bedrockRoute refuses %s",
  (model) => {
    expect(() => bedrockRoute(model)).toThrow(
      new CliError(
        `bedrock: lawbook judges with anthropic.* and openai.* models; ${model} is neither`,
      ),
    );
  },
);

test("the Messages tool request keeps the cached prefix and forces the answer tool", async () => {
  const stub = stubCreate(message([toolUse({ noul: 0.9, reason: "ok" })]));
  await messagesToolJudge(stub.create, "anthropic.claude-haiku-4-5", "bedrock").judge(REQUEST);
  const [params] = stub.calls;
  expect(params).toEqual({
    model: "anthropic.claude-haiku-4-5",
    max_tokens: 1024,
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      {
        type: "text",
        text: "Standard:\nErrors are actionable",
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: TOOL_INSTRUCTION },
    ],
    messages: [{ role: "user", content: "File: src/a.ts\n\nthrow 1;\n" }],
    tools: [
      {
        name: "answer",
        description: expect.any(String),
        input_schema: { type: "object", ...ANSWER_TOOL_SCHEMA },
      },
    ],
    tool_choice: { type: "tool", name: "answer" },
  });
  expect(params).not.toHaveProperty("output_config");
  expect(params?.tools?.[0]).not.toHaveProperty("strict");
  expect(ANSWER_TOOL_SCHEMA).toMatchObject({
    type: "object",
    required: ["noul", "reason"],
    properties: { noul: { type: "number" }, reason: { type: "string" } },
  });
  expect(ANSWER_TOOL_SCHEMA).not.toHaveProperty("$schema");
});

test.each([
  "anthropic.claude-opus-5-5",
  "anthropic.claude-sonnet-5-5",
  "anthropic.claude-fable-5-1",
])("the Messages tool request leaves the choice to %s, which refuses forcing", async (model) => {
  const stub = stubCreate(message([toolUse({ noul: 0.9, reason: "ok" })]));
  await messagesToolJudge(stub.create, model, "bedrock").judge(REQUEST);
  expect(stub.calls[0]?.tool_choice).toEqual({ type: "auto" });
});

test("a Messages tool reply with text before the call gives the call's answer and usage", async () => {
  const reply = message([
    { type: "text", text: "Checking the throw.", citations: null },
    toolUse({ noul: 0.3, reason: "throws a bare number" }),
  ]);
  const verdict = await messagesToolJudge(stubCreate(reply).create, "m", "bedrock").judge(REQUEST);
  expect(verdict).toEqual({
    decision: { type: "noul", noul: 0.3 },
    reason: "throws a bare number",
    usage: {
      inputTokens: 7,
      outputTokens: 3,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  });
});

test.each([
  [
    "no tool call",
    message([{ type: "text", text: "0.9", citations: null }], "end_turn"),
    "the judge gave no verdict for src/a.ts (stop reason: end_turn)",
  ],
  [
    "another tool",
    message([toolUse({ noul: 0.9, reason: "ok" }, "other")]),
    "the judge gave no verdict for src/a.ts (stop reason: tool_use)",
  ],
  [
    "a missing field",
    message([toolUse({ noul: 0.9 })]),
    "the judge gave no verdict for src/a.ts (✖ Invalid input: expected string, received undefined;   → at reason)",
  ],
  [
    "an out-of-range probability",
    message([toolUse({ noul: 1.4, reason: "sure" })]),
    "the judge gave an out-of-range probability 1.4 for src/a.ts",
  ],
])("a Messages tool reply with %s is a CliError", async (_name, reply, text) => {
  const failure = messagesToolJudge(stubCreate(reply).create, "m", "bedrock").judge(REQUEST);
  await expect(failure).rejects.toThrow(new CliError(text));
});

test("the Chat Completions tool request forces the answer function", async () => {
  const stub = stubChat(completion(null, [{ name: "answer", arguments: ANSWER }]));
  await chatToolJudge(stub.create, "us.openai.gpt-5.5", "bedrock").judge(REQUEST);
  expect(stub.calls[0]).toEqual({
    model: "us.openai.gpt-5.5",
    max_completion_tokens: 1024,
    messages: [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}\n\nStandard:\nErrors are actionable\n\n${TOOL_INSTRUCTION}`,
      },
      { role: "user", content: "File: src/a.ts\n\nthrow 1;\n" },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "answer",
          description: expect.any(String),
          parameters: ANSWER_TOOL_SCHEMA,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "answer" } },
  });
  expect(stub.calls[0]).not.toHaveProperty("response_format");
});

test("a Chat Completions reply with reasoning text before the call gives the call's answer", async () => {
  const reply = completion("<reasoning>The throw names no next step.</reasoning>", [
    { name: "answer", arguments: ANSWER },
  ]);
  const verdict = await chatToolJudge(stubChat(reply).create, "m", "bedrock").judge(REQUEST);
  expect(verdict).toEqual({
    decision: { type: "noul", noul: 0.8 },
    reason: "names the fix",
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  });
});

test.each([
  [
    "no tool call",
    completion('<reasoning>x</reasoning>{"noul": 0.7}', []),
    "the judge gave no verdict for src/a.ts (finish reason: stop)",
  ],
  [
    "no choices",
    { ...completion(null, []), choices: [] },
    "the judge gave no verdict for src/a.ts (finish reason: none)",
  ],
  [
    "malformed JSON",
    completion(null, [{ name: "answer", arguments: '{ {"noul": 0.7, "reason": "x"}' }]),
    "the judge gave no verdict for src/a.ts (SyntaxError: ",
  ],
  [
    "a string probability",
    completion(null, [{ name: "answer", arguments: '{"noul": "high", "reason": "x"}' }]),
    "the judge gave no verdict for src/a.ts (✖ Invalid input: expected number, received string;   → at noul)",
  ],
  [
    "an out-of-range probability",
    completion(null, [{ name: "answer", arguments: '{"noul": -0.2, "reason": "x"}' }]),
    "the judge gave an out-of-range probability -0.2 for src/a.ts",
  ],
])("a Chat Completions tool reply with %s is a CliError", async (_name, reply, text) => {
  const failure = chatToolJudge(stubChat(reply).create, "m", "bedrock").judge(REQUEST);
  await expect(failure).rejects.toBeInstanceOf(CliError);
  await expect(failure).rejects.toThrow(text);
});

test.each([
  ["us.anthropic.claude-haiku-4-5-20251001-v1:0", "anthropic.claude-haiku-4-5"],
  ["anthropic.claude-haiku-4-5-20251001-v1:0", "anthropic.claude-haiku-4-5"],
  ["global.anthropic.claude-sonnet-4-5-v1", "anthropic.claude-sonnet-4-5"],
  ["anthropic.claude-opus-5-5", "anthropic.claude-opus-5-5"],
])("undatedModelId turns %s into %s", (model, undated) => {
  expect(undatedModelId(model)).toBe(undated);
});

/** A fetch that records each request and answers every one with `status` and `body`. */
function fakeFetch(status: number, body: unknown) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const CHAT_REPLY = completion(null, [{ name: "answer", arguments: ANSWER }]);

test("an openai model goes to bedrock-runtime with the bearer token when one is set", async () => {
  const fake = fakeFetch(200, CHAT_REPLY);
  const env = { AWS_BEARER_TOKEN_BEDROCK: "bedrock-api-key-abc" };
  const judge = await bedrockJudge({ ...LLM, model: "us.openai.gpt-5.5" }, env, fake.fetch);
  const verdict = await judge.judge(REQUEST);
  expect(verdict.decision).toEqual({ type: "noul", noul: 0.8 });
  const [request] = fake.requests;
  expect(request?.url).toBe(
    "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions",
  );
  expect(request?.headers.get("authorization")).toBe("Bearer bedrock-api-key-abc");
  expect(request?.body).toMatchObject({
    model: "us.openai.gpt-5.5",
    tool_choice: { type: "function", function: { name: "answer" } },
  });
});

test("an openai model is signed with SigV4 for the bedrock service without a bearer token", async () => {
  vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", undefined);
  vi.stubEnv("AWS_PROFILE", undefined);
  vi.stubEnv("OPENAI_API_KEY", undefined);
  vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY");
  vi.stubEnv("AWS_SESSION_TOKEN", undefined);
  const fake = fakeFetch(200, CHAT_REPLY);
  const llm = { ...LLM, model: "openai.gpt-oss-120b-1:0", region: "us-west-2" };
  const judge = await bedrockJudge(llm, {}, fake.fetch);
  await judge.judge(REQUEST);
  const [request] = fake.requests;
  expect(request?.url).toBe(
    "https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1/chat/completions",
  );
  expect(request?.headers.get("authorization")).toMatch(
    /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-west-2\/bedrock\/aws4_request, /,
  );
});

test("an anthropic model goes to the Messages endpoint with the answer as a plain tool", async () => {
  const reply = message([toolUse({ noul: 0.6, reason: "partly" })]);
  const fake = fakeFetch(200, reply);
  const env = { AWS_BEARER_TOKEN_BEDROCK: "bedrock-api-key-abc" };
  const judge = await bedrockJudge(
    { ...LLM, model: "anthropic.claude-haiku-4-5" },
    env,
    fake.fetch,
  );
  const verdict = await judge.judge(REQUEST);
  expect(verdict.decision).toEqual({ type: "noul", noul: 0.6 });
  const [request] = fake.requests;
  expect(request?.url).toBe("https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages");
  expect(request?.headers.get("authorization")).toBe("Bearer bedrock-api-key-abc");
  expect(request?.body).not.toHaveProperty("output_config");
  expect(request?.body).toMatchObject({ tool_choice: { type: "tool", name: "answer" } });
});

test("the Messages endpoint's unknown-model 404 names the undated id", async () => {
  const fake = fakeFetch(404, {
    type: "error",
    error: {
      type: "not_found_error",
      message: "The model 'us.anthropic.claude-haiku-4-5-20251001-v1:0' does not exist",
    },
  });
  const env = { AWS_BEARER_TOKEN_BEDROCK: "k" };
  const llm = { ...LLM, model: "us.anthropic.claude-haiku-4-5-20251001-v1:0" };
  const judge = await bedrockJudge(llm, env, fake.fetch);
  await expect(judge.judge(REQUEST)).rejects.toThrow(
    new CliError(
      "bedrock: the Bedrock Messages endpoint does not know the model id us.anthropic.claude-haiku-4-5-20251001-v1:0; name it in the undated anthropic.<model> form, anthropic.claude-haiku-4-5",
    ),
  );
});

test("an undated id the Messages endpoint does not serve says so", async () => {
  const fake = fakeFetch(404, {
    type: "error",
    error: { type: "not_found_error", message: "The model 'x' does not exist" },
  });
  const llm = { ...LLM, model: "anthropic.claude-sonnet-5-5" };
  const judge = await bedrockJudge(llm, { AWS_BEARER_TOKEN_BEDROCK: "k" }, fake.fetch);
  await expect(judge.judge(REQUEST)).rejects.toThrow(
    new CliError(
      "bedrock: the Bedrock Messages endpoint does not know the model id anthropic.claude-sonnet-5-5; it takes undated anthropic.<model> ids, and anthropic.claude-sonnet-5-5 is not one it serves",
    ),
  );
});

test("other Messages endpoint errors keep the provider's message", async () => {
  const fake = fakeFetch(403, {
    type: "error",
    error: { type: "permission_error", message: "not entitled" },
  });
  const llm = { ...LLM, model: "anthropic.claude-haiku-4-5" };
  const judge = await bedrockJudge(llm, { AWS_BEARER_TOKEN_BEDROCK: "k" }, fake.fetch);
  const failure = judge.judge(REQUEST);
  await expect(failure).rejects.toBeInstanceOf(CliError);
  await expect(failure).rejects.toThrow(/^bedrock: 403 /);
});

test("the on-demand-throughput 400 names the inference-profile id", async () => {
  const fake = fakeFetch(400, {
    error: {
      message:
        "Invocation of model ID openai.gpt-5.5 with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.",
      type: "invalid_request_error",
    },
  });
  const llm = { ...LLM, model: "openai.gpt-5.5" };
  const judge = await bedrockJudge(llm, { AWS_BEARER_TOKEN_BEDROCK: "k" }, fake.fetch);
  await expect(judge.judge(REQUEST)).rejects.toThrow(
    new CliError(
      "bedrock: openai.gpt-5.5 has no on-demand throughput; use its inference-profile id, such as us.openai.gpt-5.5",
    ),
  );
});

test("other Chat Completions errors keep the provider's message", async () => {
  const fake = fakeFetch(400, { error: { message: "bad tools", type: "invalid_request_error" } });
  const llm = { ...LLM, model: "us.openai.gpt-5.5" };
  const judge = await bedrockJudge(llm, { AWS_BEARER_TOKEN_BEDROCK: "k" }, fake.fetch);
  const failure = judge.judge(REQUEST);
  await expect(failure).rejects.toBeInstanceOf(CliError);
  await expect(failure).rejects.toThrow(/^bedrock: 400 /);
});

test("bedrockJudge needs a region before it builds a client", async () => {
  const llm = { ...LLM, region: undefined, model: "us.openai.gpt-5.5" };
  await expect(bedrockJudge(llm, {})).rejects.toThrow("set llm.region");
});
