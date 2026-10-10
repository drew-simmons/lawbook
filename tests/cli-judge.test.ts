import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { CliError } from "../src/errors.ts";
import { claudeArgs, claudeCodeJudge, toClaudeVerdict } from "../src/judge/claude-code.ts";
import { defaultExec, type Exec, inScratchDir, translateExecError } from "../src/judge/cli.ts";
import {
  codexArgs,
  codexEvents,
  codexJudge,
  codexPrompt,
  toCodexUsage,
} from "../src/judge/codex.ts";
import { answerJsonSchema, NO_USAGE, parseAnswer } from "../src/judge/judge.ts";
import { AGENT_FILE, kiroAgent, kiroArgs, kiroEvents, kiroJudge } from "../src/judge/kiro.ts";
import {
  ANSWER_INSTRUCTION,
  CHANGED_LINES_PROMPT,
  contextBlock,
  fileBlocks,
  SYSTEM_PROMPT,
  systemTexts,
} from "../src/judge/prompt.ts";
import { useTempDir } from "./helpers.ts";

const dir = useTempDir();

const REQUEST = {
  standard: "Errors are actionable",
  files: [{ path: "src/a.ts", content: "throw 1;\n" }],
};

interface Call {
  command: string;
  args: string[];
  input: string;
  cwd: string;
  /** What the scratch directory held when the CLI ran; it is gone afterwards. */
  systemText?: string;
  schemaText?: string;
  agentText?: string;
}

/** Reads `file` under `cwd` when it exists; undefined otherwise. */
async function readIfPresent(cwd: string, file: string): Promise<string | undefined> {
  return readFile(path.join(cwd, file), "utf8").catch(() => undefined);
}

/** An `Exec` that records each call, runs `during` in the scratch directory, and answers with `stdout`. */
function fakeExec(stdout: string | Error, during?: (cwd: string) => Promise<void>) {
  const calls: Call[] = [];
  const exec: Exec = async (command, args, input, cwd) => {
    const call: Call = { command, args, input, cwd };
    const systemFile = args[args.indexOf("--system-prompt-file") + 1];
    if (args.includes("--system-prompt-file") && systemFile !== undefined) {
      call.systemText = await readFile(systemFile, "utf8");
    }
    call.schemaText = await readIfPresent(cwd, "schema.json");
    call.agentText = await readIfPresent(cwd, AGENT_FILE);
    calls.push(call);
    await during?.(cwd);
    if (stdout instanceof Error) {
      throw stdout;
    }
    return { stdout, stderr: "" };
  };
  return { exec, calls };
}

const ANSWER_SCHEMA = {
  type: "object",
  required: ["noul", "reason"],
  properties: { noul: { type: "number" }, reason: { type: "string" } },
  additionalProperties: false,
};

function claudeEnvelope(fields: Record<string, unknown>): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    usage: {
      input_tokens: 2,
      output_tokens: 40,
      cache_read_input_tokens: 1500,
      cache_creation_input_tokens: 160,
    },
    ...fields,
  });
}

test("answerJsonSchema describes the answer and drops the $schema key", () => {
  expect(answerJsonSchema()).toMatchObject(ANSWER_SCHEMA);
  expect(answerJsonSchema()).not.toHaveProperty("$schema");
  expect(answerJsonSchema()).toMatchObject({ properties: { line: { type: "number" } } });
});

test("parseAnswer carries the line the model gives and leaves it out otherwise", () => {
  expect(parseAnswer({ noul: 0.2, reason: "r", line: 7 }, "a.ts")).toEqual({
    decision: { type: "noul", noul: 0.2 },
    reason: "r",
    line: 7,
  });
  expect(parseAnswer({ noul: 0.2, reason: "r" }, "a.ts")).toEqual({
    decision: { type: "noul", noul: 0.2 },
    reason: "r",
  });
});

const CHANGED_REQUEST = {
  standard: "Errors are actionable",
  files: [
    { path: "a.ts", content: "const a = 1;\nconst b = 2;\n" },
    { path: "b.ts", content: "const c = 1;\n" },
  ],
  changed: { "a.ts": [{ start: 2, end: 2 }] },
};

test("a request with changed lines numbers those files, names their lines, and adds the instruction", () => {
  expect(fileBlocks(CHANGED_REQUEST.files, CHANGED_REQUEST.changed)).toBe(
    "File: a.ts\nChanged lines: 2\n\n1 | const a = 1;\n2 | const b = 2;\n\nFile: b.ts\n\nconst c = 1;\n",
  );
  expect(systemTexts(CHANGED_REQUEST)).toEqual([
    SYSTEM_PROMPT,
    "Standard:\nErrors are actionable",
    CHANGED_LINES_PROMPT,
  ]);
  expect(systemTexts(REQUEST)).toEqual([SYSTEM_PROMPT, "Standard:\nErrors are actionable"]);
});

test("claudeCodeJudge runs claude -p with the schema, the system file, no tools, and the files on stdin", async () => {
  const fake = fakeExec(claudeEnvelope({ structured_output: { noul: 0.9, reason: "ok" } }));
  const verdict = await claudeCodeJudge("claude-x", fake.exec).judge(REQUEST);
  expect(verdict).toEqual({
    decision: { type: "noul", noul: 0.9 },
    reason: "ok",
    usage: {
      inputTokens: 2,
      outputTokens: 40,
      cacheReadInputTokens: 1500,
      cacheCreationInputTokens: 160,
    },
  });
  const [call] = fake.calls;
  expect(call?.command).toBe("claude");
  expect(call?.input).toBe("File: src/a.ts\n\nthrow 1;\n");
  expect(call?.systemText).toBe(`${SYSTEM_PROMPT}\n\nStandard:\nErrors are actionable`);
  expect(call?.args).toEqual(claudeArgs("claude-x", path.join(call?.cwd ?? "", "system.txt")));
  expect(call?.args).toContain("--no-session-persistence");
  expect(call?.args).not.toContain("--bare");
  const schema = call?.args[call.args.indexOf("--json-schema") + 1] ?? "";
  expect(JSON.parse(schema)).toMatchObject(ANSWER_SCHEMA);
  const tools = call?.args[call.args.indexOf("--tools") + 1];
  expect(tools).toBe("");
});

test("claudeCodeJudge puts the context block in the system file and the files alone on stdin", async () => {
  const context = [{ path: "docs/style.md", content: "# Style\n" }];
  const fake = fakeExec(claudeEnvelope({ structured_output: { noul: 0.9, reason: "ok" } }));
  await claudeCodeJudge("claude-x", fake.exec).judge({ ...REQUEST, context });
  expect(fake.calls[0]?.systemText).toBe(
    `${SYSTEM_PROMPT}\n\nStandard:\nErrors are actionable\n\n${contextBlock(context)[0]}`,
  );
  expect(fake.calls[0]?.input).toBe("File: src/a.ts\n\nthrow 1;\n");
});

test("the scratch directory is empty while claude runs and gone afterwards", async () => {
  let seen: string[] = [];
  let cwd = "";
  const fake = fakeExec(
    claudeEnvelope({ structured_output: { noul: 1, reason: "ok" } }),
    async (scratch) => {
      cwd = scratch;
      const { readdir } = await import("node:fs/promises");
      seen = await readdir(scratch);
    },
  );
  await claudeCodeJudge("claude-x", fake.exec).judge(REQUEST);
  expect(seen).toEqual(["system.txt"]);
  const { stat } = await import("node:fs/promises");
  await expect(stat(cwd)).rejects.toThrow("ENOENT");
});

test("a claude run that reports an error becomes a CliError quoting its result", async () => {
  const fake = fakeExec(
    claudeEnvelope({ is_error: true, subtype: "error_during_execution", result: "Not logged in" }),
  );
  await expect(claudeCodeJudge("claude-x", fake.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("claude-code: Not logged in"),
  );
});

test("a claude result with no structured output becomes a CliError naming the file", async () => {
  const fake = fakeExec(claudeEnvelope({ result: "I need more context." }));
  await expect(claudeCodeJudge("claude-x", fake.exec).judge(REQUEST)).rejects.toThrow(
    /^the judge gave no verdict for src\/a\.ts \(/,
  );
});

test("toClaudeVerdict rejects output that is not the JSON envelope, an unknown subtype, and a bad probability", () => {
  expect(() => toClaudeVerdict("Usage: claude [options]\n", "a.ts")).toThrow(
    new CliError("claude-code: unexpected output: Usage: claude [options]"),
  );
  expect(() => toClaudeVerdict(claudeEnvelope({ subtype: "error_max_turns" }), "a.ts")).toThrow(
    new CliError("claude-code: error_max_turns"),
  );
  expect(() =>
    toClaudeVerdict(claudeEnvelope({ structured_output: { noul: 7, reason: "sure" } }), "a.ts"),
  ).toThrow(new CliError("the judge gave an out-of-range probability 7 for a.ts"));
  const bare = toClaudeVerdict(
    JSON.stringify({ structured_output: { noul: 0.5, reason: "?" } }),
    "a.ts",
  );
  expect(bare.usage.inputTokens).toBe(0);
});

const CODEX_EVENTS = [
  { type: "thread.started", thread_id: "t1" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "i1", type: "agent_message", text: "{}" } },
  {
    type: "turn.completed",
    usage: { input_tokens: 130, cached_input_tokens: 100, output_tokens: 9 },
  },
]
  .map((event) => JSON.stringify(event))
  .join("\n");

/** Writes the answer file the way `codex exec -o` does. */
function writesAnswer(answer: unknown) {
  return (cwd: string) => writeFile(path.join(cwd, "answer.json"), JSON.stringify(answer));
}

test("codexJudge runs codex exec with the schema file, the answer file, and the whole prompt on stdin", async () => {
  const fake = fakeExec(CODEX_EVENTS, writesAnswer({ noul: 0.3, reason: "no next step" }));
  const verdict = await codexJudge("gpt-x", fake.exec).judge(REQUEST);
  expect(verdict).toEqual({
    decision: { type: "noul", noul: 0.3 },
    reason: "no next step",
    usage: {
      inputTokens: 30,
      outputTokens: 9,
      cacheReadInputTokens: 100,
      cacheCreationInputTokens: 0,
    },
  });
  const [call] = fake.calls;
  expect(call?.command).toBe("codex");
  expect(call?.args).toEqual(codexArgs("gpt-x", call?.cwd ?? ""));
  expect(call?.args.slice(0, 2)).toEqual(["exec", "--skip-git-repo-check"]);
  expect(call?.args).toContain("--ignore-rules");
  expect(call?.args.at(-1)).toBe("-");
  expect(call?.input).toBe(codexPrompt(REQUEST));
  expect(call?.input).toBe(
    `${SYSTEM_PROMPT}\n\nStandard:\nErrors are actionable\n\nFile: src/a.ts\n\nthrow 1;\n`,
  );
  expect(JSON.parse(call?.schemaText ?? "")).toMatchObject(ANSWER_SCHEMA);
});

test("codexJudge reports a failed turn as a CliError naming codex", async () => {
  const failed = `${JSON.stringify({ type: "turn.started" })}\n${JSON.stringify({
    type: "turn.failed",
    error: { message: "401 Unauthorized" },
  })}\n`;
  const fake = fakeExec(failed);
  await expect(codexJudge("gpt-x", fake.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("codex: 401 Unauthorized"),
  );
  const plain = fakeExec(JSON.stringify({ type: "error", message: "stream disconnected" }));
  await expect(codexJudge("gpt-x", plain.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("codex: stream disconnected"),
  );
});

test("a codex run that exits non-zero quotes the API message inside its failed turn, else its last line", async () => {
  const body = JSON.stringify({
    type: "error",
    status: 400,
    error: { type: "invalid_request_error", message: "The 'gpt-x' model is not supported" },
  });
  const events = `${JSON.stringify({ type: "turn.started" })}\n${JSON.stringify({ type: "error", message: body })}\n${JSON.stringify({ type: "turn.failed", error: { message: body } })}\n`;
  const printed = fakeExec(
    Object.assign(new Error("exit 1"), { code: 1, stdout: events, stderr: "" }),
  );
  await expect(codexJudge("gpt-x", printed.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("codex: The 'gpt-x' model is not supported"),
  );
  const usage = fakeExec(
    Object.assign(new Error("exit 1"), { code: 1, stdout: "", stderr: "error: not logged in\n" }),
  );
  await expect(codexJudge("gpt-x", usage.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("codex: error: not logged in"),
  );
});

test("codexJudge without an answer file or with a non-JSON one gives no verdict", async () => {
  const none = fakeExec(CODEX_EVENTS);
  await expect(codexJudge("gpt-x", none.exec).judge(REQUEST)).rejects.toThrow(
    /^the judge gave no verdict for src\/a\.ts \(.*ENOENT/,
  );
  const text = fakeExec(CODEX_EVENTS, (cwd) =>
    writeFile(path.join(cwd, "answer.json"), "I'd say yes."),
  );
  await expect(codexJudge("gpt-x", text.exec).judge(REQUEST)).rejects.toThrow(
    /^the judge gave no verdict for src\/a\.ts \(SyntaxError/,
  );
});

test("codexEvents keeps the lines that parse as events and toCodexUsage reads zero without a turn", () => {
  const events = codexEvents(
    `not json\n${JSON.stringify({ type: "turn.started" })}\n{"no":"type"}\n`,
  );
  expect(events).toEqual([{ type: "turn.started" }]);
  expect(toCodexUsage(events)).toEqual({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
});

/** The event stream `kiro-cli chat --output-format stream-json` printed for one request on 2.28.0. */
function kiroStream(finished: Record<string, unknown> | undefined): string {
  const session = { sessionId: "3f062fee-1f60-4301-a076-c65564579d1d" };
  const chunk = (text: string) => ({
    type: "sessionUpdate",
    data: {
      ...session,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  });
  const events: unknown[] = [
    { type: "runStarted", data: { payloadSchema: "acp", acpProtocolVersion: 1, engine: "v2" } },
    { type: "metadata", data: { ...session, contextUsagePercentage: 1.1 } },
    chunk("```"),
    chunk('json\n{"noul": 0'),
    chunk('.05, "reason": "no next step"}\n```'),
    {
      type: "metadata",
      data: {
        ...session,
        meteringUsage: [{ value: 0.0100582, unit: "credit", unitPlural: "credits" }],
        turnDurationMs: 1439,
      },
    },
  ];
  if (finished !== undefined) {
    events.push({ type: "runFinished", data: { ...session, ...finished } });
  }
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

const KIRO_FINISHED = {
  status: "success",
  stopReason: "end_turn",
  finalText: '```json\n{"noul": 0.05, "reason": "no next step"}\n```',
  finalTextTruncated: false,
};

test("kiroJudge runs kiro-cli chat with the agent file, no tools, and the files on stdin", async () => {
  const fake = fakeExec(kiroStream(KIRO_FINISHED));
  const verdict = await kiroJudge("claude-haiku-4.5", fake.exec).judge(REQUEST);
  expect(verdict).toEqual({
    decision: { type: "noul", noul: 0.05 },
    reason: "no next step",
    usage: NO_USAGE,
  });
  const [call] = fake.calls;
  expect(call?.command).toBe("kiro-cli");
  expect(call?.args).toEqual(kiroArgs("claude-haiku-4.5"));
  expect(call?.args).toContain("--trust-tools=");
  expect(call?.args).toContain("--no-interactive");
  expect(call?.input).toBe("File: src/a.ts\n\nthrow 1;\n");
  expect(JSON.parse(call?.agentText ?? "")).toEqual(kiroAgent(REQUEST));
  expect(JSON.parse(call?.agentText ?? "")).toMatchObject({
    name: "lawbook",
    tools: [],
    includeMcpJson: false,
    prompt: `${SYSTEM_PROMPT}\n\nStandard:\nErrors are actionable\n\n${ANSWER_INSTRUCTION}`,
  });
});

test("kiroAgent puts the context block in the agent prompt before the answer instruction", () => {
  const context = [{ path: "docs/style.md", content: "# Style\n" }];
  expect(kiroAgent({ ...REQUEST, context }).prompt).toBe(
    `${SYSTEM_PROMPT}\n\nStandard:\nErrors are actionable\n\n${contextBlock(context)[0]}\n\n${ANSWER_INSTRUCTION}`,
  );
});

test("kiroJudge reads a bare JSON answer and one wrapped in prose", async () => {
  const bare = fakeExec(kiroStream({ ...KIRO_FINISHED, finalText: '{"noul":1,"reason":"fine"}' }));
  await expect(kiroJudge("m", bare.exec).judge(REQUEST)).resolves.toMatchObject({
    decision: { type: "noul", noul: 1 },
  });
  const prose = fakeExec(
    kiroStream({ ...KIRO_FINISHED, finalText: 'Sure: {"noul": 0.4, "reason": "mixed"} there.' }),
  );
  await expect(kiroJudge("m", prose.exec).judge(REQUEST)).resolves.toMatchObject({
    decision: { type: "noul", noul: 0.4 },
    reason: "mixed",
  });
});

test("kiroJudge reports a run that failed, never finished, or answered without JSON", async () => {
  const failed = fakeExec(kiroStream({ status: "error", stopReason: "refusal" }));
  await expect(kiroJudge("m", failed.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("kiro: refusal"),
  );
  const bare = fakeExec(kiroStream({ status: "cancelled" }));
  await expect(kiroJudge("m", bare.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("kiro: cancelled"),
  );
  const unfinished = fakeExec(kiroStream(undefined));
  await expect(kiroJudge("m", unfinished.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("kiro: the run did not finish"),
  );
  const text = fakeExec(kiroStream({ ...KIRO_FINISHED, finalText: "I'd say yes." }));
  await expect(kiroJudge("m", text.exec).judge(REQUEST)).rejects.toThrow(
    /^the judge gave no verdict for src\/a\.ts \(/,
  );
  const range = fakeExec(kiroStream({ ...KIRO_FINISHED, finalText: '{"noul":7,"reason":"r"}' }));
  await expect(kiroJudge("m", range.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("the judge gave an out-of-range probability 7 for src/a.ts"),
  );
});

/** The events `kiro-cli` printed on 2.28.0 for a model id it does not know, before exiting 1. */
const KIRO_RUN_ERROR = `${JSON.stringify({ type: "runStarted", data: { engine: "v2" } })}\n${JSON.stringify(
  {
    type: "runError",
    data: {
      sessionId: "s",
      stage: "prompt",
      message: "The model 'no-such-model' is not available.",
    },
  },
)}\n`;

test("a kiro run that exits non-zero quotes its runError event, else its last line", async () => {
  const printed = fakeExec(
    Object.assign(new Error("exit 1"), { code: 1, stdout: KIRO_RUN_ERROR, stderr: "" }),
  );
  await expect(kiroJudge("m", printed.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("kiro: The model 'no-such-model' is not available."),
  );
  const usage = fakeExec(
    Object.assign(new Error("exit 1"), { code: 1, stdout: "", stderr: "error: not logged in\n" }),
  );
  await expect(kiroJudge("m", usage.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("kiro: error: not logged in"),
  );
});

test("a kiro run that exits zero with a runError and no runFinished reports the error", async () => {
  const fake = fakeExec(KIRO_RUN_ERROR);
  await expect(kiroJudge("m", fake.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("kiro: The model 'no-such-model' is not available."),
  );
  const bare = fakeExec(JSON.stringify({ type: "runError", data: {} }));
  await expect(kiroJudge("m", bare.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("kiro: the run failed"),
  );
});

test("kiroEvents keeps the lines that parse as events and fills in empty data", () => {
  const events = kiroEvents(`not json\n${JSON.stringify({ type: "runStarted" })}\n{"no":"type"}\n`);
  expect(events).toEqual([{ type: "runStarted", data: {} }]);
});

test("a CLI that is not installed is a CliError naming the provider and command", async () => {
  const missing = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  const claude = fakeExec(missing);
  await expect(claudeCodeJudge("claude-x", claude.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("claude-code: claude is not installed or not on PATH"),
  );
  const codex = fakeExec(missing);
  await expect(codexJudge("gpt-x", codex.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("codex: codex is not installed or not on PATH"),
  );
  const kiro = fakeExec(missing);
  await expect(kiroJudge("m", kiro.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("kiro: kiro-cli is not installed or not on PATH"),
  );
});

test("a claude run that exits non-zero quotes its result envelope, else its last line", async () => {
  const envelope = claudeEnvelope({
    is_error: true,
    result: "Not logged in. Run claude auth login",
  });
  const printed = fakeExec(
    Object.assign(new Error("exit 1"), { code: 1, stdout: envelope, stderr: "" }),
  );
  await expect(claudeCodeJudge("claude-x", printed.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("claude-code: Not logged in. Run claude auth login"),
  );
  const usage = fakeExec(
    Object.assign(new Error("exit 1"), {
      code: 1,
      stdout: "",
      stderr: "error: unknown option '--tools'\n",
    }),
  );
  await expect(claudeCodeJudge("claude-x", usage.exec).judge(REQUEST)).rejects.toThrow(
    new CliError("claude-code: error: unknown option '--tools'"),
  );
});

test("parseAnswer names what is wrong with an answer", () => {
  expect(parseAnswer({ noul: 0.4, reason: "r" }, "a.ts")).toEqual({
    decision: { type: "noul", noul: 0.4 },
    reason: "r",
  });
  expect(() => parseAnswer({ reason: "r" }, "a.ts")).toThrow(
    /^the judge gave no verdict for a\.ts \(.*noul/,
  );
  expect(() => parseAnswer(undefined, "a.ts")).toThrow(CliError);
});

test("translateExecError names a missing command, quotes a failed one, and passes bugs through", () => {
  expect(() => translateExecError({ code: "ENOENT" }, "codex", "codex")).toThrow(
    new CliError("codex: codex is not installed or not on PATH"),
  );
  const failed = { code: 1, stdout: "", stderr: "warning: slow\nerror: not logged in\n\n" };
  expect(() => translateExecError(failed, "claude-code", "claude")).toThrow(
    new CliError("claude-code: error: not logged in"),
  );
  expect(() =>
    translateExecError({ code: 2, stdout: "from stdout\n" }, "kiro", "kiro-cli"),
  ).toThrow(new CliError("kiro: from stdout"));
  expect(() => translateExecError({ code: 3 }, "codex", "codex")).toThrow(
    new CliError("codex: exited with 3"),
  );
  expect(() => translateExecError(new TypeError("boom"), "codex", "codex")).toThrow(TypeError);
  expect(() => translateExecError("boom", "codex", "codex")).toThrow("boom");
});

test("defaultExec feeds stdin, collects output, and rejects with the exit code or ENOENT", async () => {
  const script = path.join(dir(), "echo.cjs");
  await writeFile(
    script,
    'let input = ""; process.stdin.on("data", (c) => (input += c)); process.stdin.on("end", () => { process.stdout.write(input.toUpperCase()); process.stderr.write("done"); process.exit(Number(process.argv[2])); });',
  );
  const ok = await defaultExec(process.execPath, [script, "0"], "hello", dir());
  expect(ok).toEqual({ stdout: "HELLO", stderr: "done" });
  await expect(defaultExec(process.execPath, [script, "3"], "x", dir())).rejects.toMatchObject({
    code: 3,
    stderr: "done",
  });
  await expect(
    defaultExec("lawbook-no-such-command", [], "x", dir()).catch((error: unknown) =>
      translateExecError(error, "codex", "lawbook-no-such-command"),
    ),
  ).rejects.toThrow(new CliError("codex: lawbook-no-such-command is not installed or not on PATH"));
});

test("inScratchDir removes the directory when the work throws", async () => {
  let scratch = "";
  await expect(
    inScratchDir(async (d) => {
      scratch = d;
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  const { stat } = await import("node:fs/promises");
  await expect(stat(scratch)).rejects.toThrow("ENOENT");
});
