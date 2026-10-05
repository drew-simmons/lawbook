import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { CliError } from "../src/errors.ts";
import { claudeArgs, claudeCodeJudge, toClaudeVerdict } from "../src/judge/claude-code.ts";
import {
  answerJsonSchema,
  defaultExec,
  type Exec,
  inScratchDir,
  parseAnswer,
  translateExecError,
} from "../src/judge/cli.ts";
import {
  codexArgs,
  codexEvents,
  codexJudge,
  codexPrompt,
  toCodexUsage,
} from "../src/judge/codex.ts";
import { contextBlock, SYSTEM_PROMPT } from "../src/judge/messages.ts";
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
    if (args.includes("--output-schema")) {
      call.schemaText = await readFile(path.join(cwd, "schema.json"), "utf8");
    }
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
  expect(() => translateExecError({ code: 2, stdout: "from stdout\n" }, "codex", "codex")).toThrow(
    new CliError("codex: from stdout"),
  );
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
