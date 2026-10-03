import { expect, test } from "vitest";
import { DEFAULT_MODELS } from "../src/config.ts";
import { defaultJudges } from "../src/judge/index.ts";
import { fakeJudge, lawbook, lawbookWith, noul, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

const STANDARD =
  "  - id: actionable-errors\n    files: ['**/*.ts']\n    standard: Errors say what to do next\n";

async function config(body: string): Promise<void> {
  await write(dir(), "lawbook.yaml", `version: 1\n${body}`);
}

test("standard rule passes when the judge passes every file", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "throw new Error('set NAME');\n");
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("PASS actionable-errors\n\n1 passed, 0 failed, 0 warned, 0 skipped\n");
});

test("standard rule fails listing each failing file with its reason and probability", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "throw new Error('bad');\n");
  await write(dir(), "b.ts", "throw new Error('set NAME');\n");
  await write(dir(), "c.ts", "throw new Error('oops');\n");
  const fake = fakeJudge({
    "a.ts": noul(0.1, "'bad' names no next step"),
    "c.ts": noul(0.2, "'oops' names no next step"),
  });
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "FAIL actionable-errors\n  a.ts: 'bad' names no next step (noul 0.10)\n  c.ts: 'oops' names no next step (noul 0.20)\n\n0 passed, 1 failed, 0 warned, 0 skipped\n",
  );
});

test("a file at the default threshold passes and one just under it fails", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "const a = 1;\n");
  await write(dir(), "b.ts", "const b = 2;\n");
  const fake = fakeJudge({ "a.ts": noul(0.5, "cannot tell"), "b.ts": noul(0.49, "under") });
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "FAIL actionable-errors\n  b.ts: under (noul 0.49)\n\n0 passed, 1 failed, 0 warned, 0 skipped\n",
  );
});

test("threshold raises the bar for a standard rule", async () => {
  await config(`rules:\n${STANDARD}    threshold: 0.9\n`);
  await write(dir(), "a.ts", "const a = 1;\n");
  const fake = fakeJudge({ "a.ts": noul(0.8, "close") });
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "FAIL actionable-errors\n  a.ts: close (noul 0.80)\n\n0 passed, 1 failed, 0 warned, 0 skipped\n",
  );
});

test("--format json carries every decision and the failing finding's decision", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "const a = 1;\n");
  await write(dir(), "b.ts", "const b = 2;\n");
  const fake = fakeJudge({ "a.ts": noul(0.1, "no next step") });
  const result = await lawbookWith(fake.deps, "check", dir(), "--format", "json");
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toEqual({
    results: [
      {
        id: "actionable-errors",
        kind: "standard",
        level: "error",
        status: "fail",
        findings: [
          { path: "a.ts", message: "no next step", decision: { type: "noul", noul: 0.1 } },
        ],
        decisions: {
          "a.ts": { type: "noul", noul: 0.1 },
          "b.ts": { type: "noul", noul: 1 },
        },
      },
    ],
    summary: { passed: 0, failed: 1, warned: 0, skipped: 0 },
  });
});

test("standard rule sends the standard, path, and content for each file in order", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "b.ts", "const b = 2;\n");
  await write(dir(), "a.ts", "const a = 1;\n");
  const fake = fakeJudge();
  await lawbookWith(fake.deps, "check", dir());
  expect(fake.requests).toEqual([
    { standard: "Errors say what to do next", path: "a.ts", content: "const a = 1;\n" },
    { standard: "Errors say what to do next", path: "b.ts", content: "const b = 2;\n" },
  ]);
});

test("standard rule with no selected files passes without asking the judge", async () => {
  await config(`rules:\n${STANDARD}`);
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir(), "--format", "json");
  expect(result.code).toBe(0);
  expect(fake.requests).toEqual([]);
  expect(JSON.parse(result.stdout).results).toEqual([
    {
      id: "actionable-errors",
      kind: "standard",
      level: "error",
      status: "pass",
      findings: [],
      decisions: {},
    },
  ]);
});

test("--no-llm skips standard rules without building a judge", async () => {
  await config(`rules:\n${STANDARD}  - id: no-env\n    absent: .env\n`);
  await write(dir(), "a.ts", "const a = 1;\n");
  const result = await lawbook("check", dir(), "--no-llm");
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    "SKIP actionable-errors\nPASS no-env\n\n1 passed, 0 failed, 0 warned, 1 skipped\n",
  );
});

test("--no-llm leaves the exit code to the other rules", async () => {
  await config(`rules:\n${STANDARD}  - id: readme\n    exists: README.md\n`);
  const result = await lawbook("check", dir(), "--no-llm");
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("SKIP actionable-errors\nFAIL readme\n");
});

test("--format json reports skipped rules", async () => {
  await config(`rules:\n${STANDARD}`);
  const result = await lawbook("check", dir(), "--no-llm", "--format", "json");
  expect(JSON.parse(result.stdout)).toEqual({
    results: [
      { id: "actionable-errors", kind: "standard", level: "error", status: "skip", findings: [] },
    ],
    summary: { passed: 0, failed: 0, warned: 0, skipped: 1 },
  });
});

test("a warn standard rule below the threshold prints WARN and exits zero", async () => {
  await config(`rules:\n${STANDARD}    level: warn\n`);
  await write(dir(), "a.ts", "throw new Error('bad');\n");
  const fake = fakeJudge({ "a.ts": noul(0.1, "'bad' names no next step") });
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    "WARN actionable-errors\n  a.ts: 'bad' names no next step (noul 0.10)\n\n0 passed, 0 failed, 1 warned, 0 skipped\n",
  );
});

test("--no-llm reports a skipped rule's level", async () => {
  await config(`rules:\n${STANDARD}    level: warn\n`);
  const result = await lawbook("check", dir(), "--no-llm", "--format", "json");
  expect(JSON.parse(result.stdout).results).toEqual([
    { id: "actionable-errors", kind: "standard", level: "warn", status: "skip", findings: [] },
  ]);
});

test("a config without standard rules never builds a judge", async () => {
  await config("rules:\n  - id: no-env\n    absent: .env\n");
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(0);
  expect(fake.built).toEqual([]);
});

test("--only without a standard rule never builds a judge", async () => {
  await config(`rules:\n${STANDARD}  - id: no-env\n    absent: .env\n`);
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir(), "--only", "no-env");
  expect(result.code).toBe(0);
  expect(fake.built).toEqual([]);
});

test("check builds the judge once with the default provider and model", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "const a = 1;\n");
  await write(dir(), "b.ts", "const b = 1;\n");
  const fake = fakeJudge();
  await lawbookWith(fake.deps, "check", dir());
  expect(fake.built).toEqual([{ provider: "bedrock", model: DEFAULT_MODELS.bedrock }]);
});

test("check passes the configured provider, model, and region to the factory", async () => {
  await config(
    `llm:\n  provider: anthropic\n  model: claude-sonnet-5-5\n  region: eu-west-1\nrules:\n${STANDARD}`,
  );
  await write(dir(), "a.ts", "const a = 1;\n");
  const fake = fakeJudge();
  await lawbookWith(fake.deps, "check", dir());
  expect(fake.built).toEqual([
    { provider: "anthropic", model: "claude-sonnet-5-5", region: "eu-west-1" },
  ]);
});

test("check fills in the default model for the configured provider", async () => {
  await config(`llm:\n  provider: anthropic\nrules:\n${STANDARD}`);
  await write(dir(), "a.ts", "const a = 1;\n");
  const fake = fakeJudge();
  await lawbookWith(fake.deps, "check", dir());
  expect(fake.built).toEqual([{ provider: "anthropic", model: DEFAULT_MODELS.anthropic }]);
});

test("check rejects an unknown provider", async () => {
  await config(`llm:\n  provider: openai\nrules:\n${STANDARD}`);
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("llm.provider");
});

test("check rejects an unknown llm key", async () => {
  await config(`llm:\n  temperature: 0\nrules:\n${STANDARD}`);
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('Unrecognized key: "temperature"');
});

test("a judge factory error exits two with its message", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "const a = 1;\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("error: Error: tests must inject a judge\n");
});

test("a judge error exits two before any report", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "const a = 1;\n");
  const fake = fakeJudge();
  fake.judge.judge = () => Promise.reject(new Error("socket hung up"));
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("error: Error: socket hung up\n");
});

test("default judges cover every provider", () => {
  expect(Object.keys(defaultJudges).toSorted()).toEqual(["anthropic", "bedrock"]);
});
