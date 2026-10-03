import { expect, test } from "vitest";
import { DEFAULT_MODELS } from "../src/config.ts";
import { CliError } from "../src/errors.ts";
import { defaultJudges } from "../src/judge/index.ts";
import type { Verdict } from "../src/judge/judge.ts";
import { NO_TOTALS } from "../src/result.ts";
import { NOT_JUDGED } from "../src/rules/llm.ts";
import {
  type FakeJudge,
  fakeJudge,
  requestKey,
  lawbook,
  lawbookWith,
  noul,
  usageLine,
  usageTotals,
  useTempDir,
  write,
} from "./helpers.ts";

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
  expect(result.stdout).toBe(
    `PASS actionable-errors\n\n1 passed, 0 failed, 0 warned, 0 errored, 0 skipped\n${usageLine(1)}`,
  );
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
    `FAIL actionable-errors\n  a.ts: 'bad' names no next step (noul 0.10)\n  c.ts: 'oops' names no next step (noul 0.20)\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n${usageLine(3)}`,
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
    `FAIL actionable-errors\n  b.ts: under (noul 0.49)\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n${usageLine(2)}`,
  );
});

test("threshold raises the bar for a standard rule", async () => {
  await config(`rules:\n${STANDARD}    threshold: 0.9\n`);
  await write(dir(), "a.ts", "const a = 1;\n");
  const fake = fakeJudge({ "a.ts": noul(0.8, "close") });
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    `FAIL actionable-errors\n  a.ts: close (noul 0.80)\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n${usageLine(1)}`,
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
        usage: usageTotals(2),
      },
    ],
    summary: { passed: 0, failed: 1, warned: 0, errored: 0, skipped: 0, usage: usageTotals(2) },
  });
});

test("standard rule sends the standard, path, and content for each file in order", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "b.ts", "const b = 2;\n");
  await write(dir(), "a.ts", "const a = 1;\n");
  const fake = fakeJudge();
  await lawbookWith(fake.deps, "check", dir(), "--no-cache");
  expect(fake.requests).toEqual([
    {
      standard: "Errors say what to do next",
      files: [{ path: "a.ts", content: "const a = 1;\n" }],
    },
    {
      standard: "Errors say what to do next",
      files: [{ path: "b.ts", content: "const b = 2;\n" }],
    },
  ]);
});

/**
 * Makes the fake judge wait a turn per request and report the most requests
 * it ever had in flight at once.
 */
function gate(fake: FakeJudge, verdicts: Record<string, Verdict> = {}): () => number {
  let inFlight = 0;
  let peak = 0;
  fake.judge.judge = async (request) => {
    fake.requests.push(request);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    return verdicts[requestKey(request)] ?? noul(1, "fine");
  };
  return () => peak;
}

async function writeFiles(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await write(dir(), `${String.fromCharCode(97 + i)}.ts`, `const x = ${i};\n`);
  }
}

test("standard rules judge up to llm.concurrency files at once", async () => {
  await config(`llm:\n  concurrency: 2\nrules:\n${STANDARD}`);
  await writeFiles(5);
  const fake = fakeJudge();
  const peak = gate(fake);
  const result = await lawbookWith(fake.deps, "check", dir(), "--no-cache");
  expect(result.code).toBe(0);
  expect(peak()).toBe(2);
  expect(fake.requests.map(requestKey)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]);
});

test("concurrency defaults to four", async () => {
  await config(`rules:\n${STANDARD}`);
  await writeFiles(5);
  const fake = fakeJudge();
  const peak = gate(fake);
  await lawbookWith(fake.deps, "check", dir(), "--no-cache");
  expect(peak()).toBe(4);
});

test("decisions and findings stay in path order when files finish out of order", async () => {
  await config(`llm:\n  concurrency: 2\nrules:\n${STANDARD}`);
  await writeFiles(2);
  const fake = fakeJudge();
  fake.judge.judge = async (request) => {
    if (requestKey(request) === "a.ts") {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      return noul(0.1, "late");
    }
    return noul(0.2, "early");
  };
  const result = await lawbookWith(fake.deps, "check", dir(), "--format", "json");
  const [rule] = JSON.parse(result.stdout).results;
  expect(Object.keys(rule.decisions)).toEqual(["a.ts", "b.ts"]);
  expect(rule.findings.map((finding: { path: string }) => finding.path)).toEqual(["a.ts", "b.ts"]);
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
      usage: NO_TOTALS,
    },
  ]);
});

test("--no-llm skips standard rules without building a judge", async () => {
  await config(`rules:\n${STANDARD}  - id: no-env\n    absent: .env\n`);
  await write(dir(), "a.ts", "const a = 1;\n");
  const result = await lawbook("check", dir(), "--no-llm");
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    "SKIP actionable-errors\nPASS no-env\n\n1 passed, 0 failed, 0 warned, 0 errored, 1 skipped\n",
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
    summary: { passed: 0, failed: 0, warned: 0, errored: 0, skipped: 1, usage: NO_TOTALS },
  });
});

test("a warn standard rule below the threshold prints WARN and exits zero", async () => {
  await config(`rules:\n${STANDARD}    level: warn\n`);
  await write(dir(), "a.ts", "throw new Error('bad');\n");
  const fake = fakeJudge({ "a.ts": noul(0.1, "'bad' names no next step") });
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    `WARN actionable-errors\n  a.ts: 'bad' names no next step (noul 0.10)\n\n0 passed, 0 failed, 1 warned, 0 errored, 0 skipped\n${usageLine(1)}`,
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
  expect(fake.built).toMatchObject([]);
});

test("--only without a standard rule never builds a judge", async () => {
  await config(`rules:\n${STANDARD}  - id: no-env\n    absent: .env\n`);
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir(), "--only", "no-env");
  expect(result.code).toBe(0);
  expect(fake.built).toMatchObject([]);
});

test("check builds the judge once with the default provider and model", async () => {
  await config(`rules:\n${STANDARD}`);
  await write(dir(), "a.ts", "const a = 1;\n");
  await write(dir(), "b.ts", "const b = 1;\n");
  const fake = fakeJudge();
  await lawbookWith(fake.deps, "check", dir());
  expect(fake.built).toMatchObject([
    { provider: "bedrock", model: DEFAULT_MODELS.bedrock, concurrency: 4 },
  ]);
});

test("check passes the configured provider, model, and region to the factory", async () => {
  await config(
    `llm:\n  provider: bedrock\n  model: anthropic.claude-sonnet-5-5\n  region: eu-west-1\nrules:\n${STANDARD}`,
  );
  await write(dir(), "a.ts", "const a = 1;\n");
  const fake = fakeJudge();
  await lawbookWith(fake.deps, "check", dir());
  expect(fake.built).toMatchObject([
    {
      provider: "bedrock",
      model: "anthropic.claude-sonnet-5-5",
      region: "eu-west-1",
      concurrency: 4,
    },
  ]);
});

test("check fills in the default model for the configured provider", async () => {
  await config(`llm:\n  provider: anthropic\nrules:\n${STANDARD}`);
  await write(dir(), "a.ts", "const a = 1;\n");
  const fake = fakeJudge();
  await lawbookWith(fake.deps, "check", dir());
  expect(fake.built).toMatchObject([
    { provider: "anthropic", model: DEFAULT_MODELS.anthropic, concurrency: 4 },
  ]);
});

test("a file over llm.maxBytes is skipped without a request", async () => {
  await config(`llm:\n  maxBytes: 16\nrules:\n${STANDARD}`);
  await write(dir(), "a.ts", "const a = 1;\n");
  await write(dir(), "big.ts", "const big = 'xxxxx';\n");
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(0);
  expect(fake.requests.map(requestKey)).toEqual(["a.ts"]);
  expect(result.stdout).toBe(
    `PASS actionable-errors\n  big.ts: skipped, 21 bytes over llm.maxBytes 16\n\n1 passed, 0 failed, 0 warned, 0 errored, 0 skipped\n${usageLine(1)}`,
  );
  const json = await lawbookWith(fakeJudge().deps, "check", dir(), "--format", "json");
  expect(JSON.parse(json.stdout).results[0]).toMatchObject({
    status: "pass",
    decisions: { "a.ts": { type: "noul", noul: 1 } },
    skipped: [{ path: "big.ts", message: "skipped, 21 bytes over llm.maxBytes 16" }],
  });
});

test("llm.maxBytes leaves deterministic rules alone", async () => {
  await config(
    "llm:\n  maxBytes: 1\nrules:\n  - id: no-todo\n    files: ['**/*.ts']\n    forbid: TODO\n",
  );
  await write(dir(), "a.ts", "// TODO a\n");
  const result = await lawbook("check", dir());
  expect(result.stdout).toContain("FAIL no-todo\n  a.ts:1: // TODO a\n");
  const json = await lawbook("check", dir(), "--format", "json");
  expect(JSON.parse(json.stdout).results[0]).not.toHaveProperty("skipped");
});

test("check rejects region with the anthropic provider", async () => {
  await config(`llm:\n  provider: anthropic\n  region: eu-west-1\nrules:\n${STANDARD}`);
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("llm.region");
  expect(result.stderr).toContain("region applies to the bedrock provider only");
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

/** Makes the fake judge reject `path` with `error` and answer the rest as before. */
function rejecting(fake: FakeJudge, path: string, error: Error): void {
  const answer = fake.judge.judge;
  fake.judge.judge = (request) => {
    if (requestKey(request) !== path) {
      return answer(request);
    }
    fake.requests.push(request);
    return Promise.reject(error);
  };
}

test("a provider error on one file reports ERROR with the other verdicts and exits two", async () => {
  await config(`llm:\n  concurrency: 1\nrules:\n${STANDARD}`);
  await writeFiles(3);
  const fake = fakeJudge({ "a.ts": noul(0.1, "'bad' names no next step") });
  rejecting(fake, "b.ts", new CliError("bedrock: 401 invalid x-api-key"));
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(
    `ERROR actionable-errors\n  a.ts: 'bad' names no next step (noul 0.10)\n  b.ts: bedrock: 401 invalid x-api-key\n  c.ts: not judged after an earlier error\n\n0 passed, 0 failed, 0 warned, 1 errored, 0 skipped\n${usageLine(1)}`,
  );
});

test("after the first error no new requests go out but in-flight ones finish", async () => {
  await config(`llm:\n  concurrency: 2\nrules:\n${STANDARD}`);
  await writeFiles(4);
  const fake = fakeJudge();
  fake.judge.judge = async (request) => {
    fake.requests.push(request);
    if (requestKey(request) === "b.ts") {
      throw new CliError("anthropic: 429 rate limited");
    }
    await new Promise((resolve) => setImmediate(resolve));
    return noul(0.3, "slow but judged");
  };
  const result = await lawbookWith(fake.deps, "check", dir(), "--format", "json", "--no-cache");
  expect(result.code).toBe(2);
  expect(fake.requests.map(requestKey)).toEqual(["a.ts", "b.ts"]);
  const [rule] = JSON.parse(result.stdout).results;
  expect(rule).toEqual({
    id: "actionable-errors",
    kind: "standard",
    level: "error",
    status: "error",
    findings: [
      { path: "a.ts", message: "slow but judged", decision: { type: "noul", noul: 0.3 } },
      { path: "b.ts", message: "anthropic: 429 rate limited" },
      { path: "c.ts", message: NOT_JUDGED },
      { path: "d.ts", message: NOT_JUDGED },
    ],
    decisions: { "a.ts": { type: "noul", noul: 0.3 } },
    usage: usageTotals(1),
  });
});

test("an errored rule exits two even when another rule fails", async () => {
  await config(`rules:\n${STANDARD}  - id: readme\n    exists: README.md\n`);
  await writeFiles(1);
  const fake = fakeJudge();
  rejecting(fake, "a.ts", new CliError("bedrock: no credentials"));
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(2);
  expect(result.stdout).toBe(
    "ERROR actionable-errors\n  a.ts: bedrock: no credentials\nFAIL readme\n  README.md: missing\n\n0 passed, 1 failed, 0 warned, 1 errored, 0 skipped\n",
  );
});

test("a warn standard rule with a provider error is still an error", async () => {
  await config(`rules:\n${STANDARD}    level: warn\n`);
  await writeFiles(1);
  const fake = fakeJudge();
  rejecting(fake, "a.ts", new CliError("bedrock: no credentials"));
  const result = await lawbookWith(fake.deps, "check", dir());
  expect(result.code).toBe(2);
  expect(result.stdout).toContain("ERROR actionable-errors\n");
});

test("a non-CliError from the judge still aborts the run", async () => {
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
