import { APIConnectionError, OpenAIError } from "openai/error";
import type { ParsedChatCompletion } from "openai/resources/chat/completions";
import { expect, test } from "vitest";
import { CliError } from "../src/errors.ts";
import { chatJudge, type ChatParams, type ChatParseFn, toChatUsage } from "../src/judge/chat.ts";
import type { Answer } from "../src/judge/judge.ts";
import { openaiKey, PLACEHOLDER_KEY } from "../src/judge/openai.ts";
import { contextBlock, SYSTEM_PROMPT } from "../src/judge/messages.ts";

const REQUEST = {
  standard: "Errors are actionable",
  files: [{ path: "src/a.ts", content: "throw 1;\n" }],
};

interface Choice {
  parsed: Answer | null;
  refusal?: string | null;
  finish_reason?: "stop" | "length" | "content_filter";
}

function completion(choices: Choice[], usage?: ParsedChatCompletion<Answer>["usage"]) {
  return {
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 0,
    model: "gpt-x",
    choices: choices.map((choice, index) => ({
      index,
      finish_reason: choice.finish_reason ?? "stop",
      logprobs: null,
      message: {
        role: "assistant",
        content: JSON.stringify(choice.parsed),
        refusal: choice.refusal ?? null,
        parsed: choice.parsed,
      },
    })),
    usage,
  } as ParsedChatCompletion<Answer>;
}

/** A `parse` that records its params and answers with `result`. */
function stubParse(result: ParsedChatCompletion<Answer> | Error) {
  const calls: ChatParams[] = [];
  const parse: ChatParseFn = async (params) => {
    calls.push(params);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return { parse, calls };
}

test("chatJudge sends the prompt as system and user messages with the answer format", async () => {
  const stub = stubParse(completion([{ parsed: { noul: 0.9, reason: "ok" } }]));
  await chatJudge(stub.parse, "gpt-x").judge(REQUEST);
  const [params] = stub.calls;
  expect(params?.model).toBe("gpt-x");
  expect(params?.max_completion_tokens).toBe(1024);
  expect(params?.messages).toEqual([
    { role: "system", content: `${SYSTEM_PROMPT}\n\nStandard:\nErrors are actionable` },
    { role: "user", content: "File: src/a.ts\n\nthrow 1;\n" },
  ]);
  expect(params?.response_format.type).toBe("json_schema");
  expect(params?.response_format.json_schema.schema).toMatchObject({
    type: "object",
    required: ["noul", "reason"],
    properties: { noul: { type: "number" }, reason: { type: "string" } },
  });
});

test("chatJudge returns the answer as a noul decision with its reason and usage", async () => {
  const usage = {
    prompt_tokens: 120,
    completion_tokens: 8,
    total_tokens: 128,
    prompt_tokens_details: { cached_tokens: 100 },
  };
  const stub = stubParse(completion([{ parsed: { noul: 0.2, reason: "no next step" } }], usage));
  const verdict = await chatJudge(stub.parse, "gpt-x").judge(REQUEST);
  expect(verdict).toEqual({
    decision: { type: "noul", noul: 0.2 },
    reason: "no next step",
    usage: {
      inputTokens: 20,
      outputTokens: 8,
      cacheReadInputTokens: 100,
      cacheCreationInputTokens: 0,
    },
  });
});

test("toChatUsage reads zero when the provider reports no usage or no cache details", () => {
  expect(toChatUsage(undefined)).toEqual({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
  expect(toChatUsage({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 })).toMatchObject({
    inputTokens: 5,
    cacheReadInputTokens: 0,
  });
});

test("a refusal becomes a CliError quoting it", async () => {
  const stub = stubParse(completion([{ parsed: null, refusal: "I cannot help with that." }]));
  await expect(chatJudge(stub.parse, "gpt-x").judge(REQUEST)).rejects.toThrow(
    new CliError("the judge gave no verdict for src/a.ts (I cannot help with that.)"),
  );
});

test("a truncated answer becomes a CliError naming the finish reason", async () => {
  const stub = stubParse(completion([{ parsed: null, finish_reason: "length" }]));
  await expect(chatJudge(stub.parse, "gpt-x").judge(REQUEST)).rejects.toThrow(
    new CliError("the judge gave no verdict for src/a.ts (finish reason: length)"),
  );
});

test("an empty choice list becomes a CliError", async () => {
  const stub = stubParse(completion([]));
  await expect(chatJudge(stub.parse, "gpt-x").judge(REQUEST)).rejects.toThrow(
    new CliError("the judge gave no verdict for src/a.ts (finish reason: none)"),
  );
});

test("an out-of-range probability becomes a CliError", async () => {
  const stub = stubParse(completion([{ parsed: { noul: 1.5, reason: "sure" } }]));
  await expect(chatJudge(stub.parse, "gpt-x").judge(REQUEST)).rejects.toThrow(
    new CliError("the judge gave an out-of-range probability 1.5 for src/a.ts"),
  );
});

test("SDK errors become CliErrors naming openai and other errors pass through", async () => {
  const connection = stubParse(new APIConnectionError({ message: "socket hung up" }));
  await expect(chatJudge(connection.parse, "gpt-x").judge(REQUEST)).rejects.toThrow(
    new CliError("openai: socket hung up"),
  );
  const generic = stubParse(new OpenAIError("bad key"));
  await expect(chatJudge(generic.parse, "gpt-x").judge(REQUEST)).rejects.toThrow(
    new CliError("openai: bad key"),
  );
  const bug = stubParse(new TypeError("boom"));
  await expect(chatJudge(bug.parse, "gpt-x").judge(REQUEST)).rejects.toThrow(TypeError);
});

test("chatJudge appends the context block to the system message", async () => {
  const context = [{ path: "docs/style.md", content: "# Style\n" }];
  const stub = stubParse(completion([{ parsed: { noul: 0.9, reason: "ok" } }]));
  await chatJudge(stub.parse, "gpt-x").judge({ ...REQUEST, context });
  expect(stub.calls[0]?.messages[0]).toEqual({
    role: "system",
    content: `${SYSTEM_PROMPT}\n\nStandard:\nErrors are actionable\n\n${contextBlock(context)[0]}`,
  });
});

const OPENAI_LLM = {
  provider: "openai" as const,
  model: "gpt-x",
  concurrency: 4,
  maxBytes: 131072,
  cache: true,
};

test("openaiKey takes the environment, else a placeholder for a baseUrl server, else errors", () => {
  const local = { ...OPENAI_LLM, baseUrl: "http://localhost:11434/v1" };
  expect(openaiKey(OPENAI_LLM, { OPENAI_API_KEY: "sk-1" })).toBe("sk-1");
  expect(openaiKey(local, { OPENAI_API_KEY: "sk-1" })).toBe("sk-1");
  expect(openaiKey(local, {})).toBe(PLACEHOLDER_KEY);
  expect(() => openaiKey(OPENAI_LLM, {})).toThrow(
    new CliError("openai: set OPENAI_API_KEY in the environment"),
  );
});
