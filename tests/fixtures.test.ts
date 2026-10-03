import { readdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { CliError } from "../src/errors.ts";
import { fakeJudge, lawbook, lawbookWith, noul, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

const RULE =
  "  - id: actionable-errors\n    files: ['src/**/*.ts']\n    standard: Errors say what to do next\n    fixtures:\n      pass: [fixtures/good.ts]\n      fail: [fixtures/bad.ts, fixtures/worse.ts]\n";

async function config(body: string): Promise<void> {
  await write(dir(), "lawbook.yaml", `version: 1\n${body}`);
}

async function fixtures(): Promise<void> {
  await write(dir(), "fixtures/good.ts", "throw new Error('run lawbook init first');\n");
  await write(dir(), "fixtures/bad.ts", "throw new Error('bad');\n");
  await write(dir(), "fixtures/worse.ts", "throw new Error('worse');\n");
}

test("passes when every fixture lands where it should", async () => {
  await config(`rules:\n${RULE}`);
  await fixtures();
  const fake = fakeJudge({
    "fixtures/good.ts": noul(0.9, "names the fix"),
    "fixtures/bad.ts": noul(0.1, "no next step"),
    "fixtures/worse.ts": noul(0.2, "no next step"),
  });
  const result = await lawbookWith(fake.deps, "test", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("PASS actionable-errors\n\n3 fixtures, 0 misclassified\n");
  expect(fake.requests.map((request) => request.files.map((file) => file.path)).toSorted()).toEqual(
    [["fixtures/bad.ts"], ["fixtures/good.ts"], ["fixtures/worse.ts"]],
  );
});

test("exits one naming the fixtures on the wrong side with their reasons", async () => {
  await config(`rules:\n${RULE}`);
  await fixtures();
  const fake = fakeJudge({
    "fixtures/good.ts": noul(0.3, "vague"),
    "fixtures/bad.ts": noul(0.1, "no next step"),
  });
  const result = await lawbookWith(fake.deps, "test", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "FAIL actionable-errors\n  fixtures/good.ts: expected pass, judged fail (noul 0.30): vague\n  fixtures/worse.ts: expected fail, judged pass (noul 1.00): fine\n\n3 fixtures, 2 misclassified\n",
  );
});

test("--format json carries every case", async () => {
  await config(`rules:\n${RULE}`);
  await fixtures();
  const fake = fakeJudge({ "fixtures/bad.ts": noul(0.1, "no next step") });
  const result = await lawbookWith(fake.deps, "test", dir(), "--format", "json");
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toEqual({
    rules: [
      {
        id: "actionable-errors",
        cases: [
          {
            path: "fixtures/good.ts",
            expected: "pass",
            actual: "pass",
            decision: { type: "noul", noul: 1 },
            reason: "fine",
          },
          {
            path: "fixtures/bad.ts",
            expected: "fail",
            actual: "fail",
            decision: { type: "noul", noul: 0.1 },
            reason: "no next step",
          },
          {
            path: "fixtures/worse.ts",
            expected: "fail",
            actual: "pass",
            decision: { type: "noul", noul: 1 },
            reason: "fine",
          },
        ],
      },
    ],
    summary: { cases: 3, misclassified: 1 },
  });
});

test("honours the rule's threshold", async () => {
  await config(`rules:\n${RULE}    threshold: 0.95\n`);
  await fixtures();
  const fake = fakeJudge({
    "fixtures/good.ts": noul(0.9, "nearly"),
    "fixtures/bad.ts": noul(0.1, "no"),
    "fixtures/worse.ts": noul(0.1, "no"),
  });
  const result = await lawbookWith(fake.deps, "test", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toContain(
    "fixtures/good.ts: expected pass, judged fail (noul 0.90): nearly\n",
  );
});

test("with a missing fixture exits two naming the rule", async () => {
  await config(`rules:\n${RULE}`);
  const result = await lawbookWith(fakeJudge().deps, "test", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toBe(
    'error: rule "actionable-errors": fixture fixtures/good.ts is missing or binary\n',
  );
});

test("skips rules without fixtures and honours --only", async () => {
  await config(
    `rules:\n${RULE}  - id: plain\n    files: ['**/*.ts']\n    standard: Plain\n  - id: other\n    files: ['**/*.ts']\n    standard: Other\n    fixtures: { pass: [fixtures/good.ts] }\n`,
  );
  await fixtures();
  const fake = fakeJudge({
    "fixtures/bad.ts": noul(0.1, "no"),
    "fixtures/worse.ts": noul(0.1, "no"),
  });
  const all = await lawbookWith(fake.deps, "test", dir());
  expect(all.stdout).toBe("PASS actionable-errors\nPASS other\n\n4 fixtures, 0 misclassified\n");
  const only = await lawbookWith(fake.deps, "test", dir(), "--only", "other");
  expect(only.stdout).toBe("PASS other\n\n1 fixture, 0 misclassified\n");
  expect(fake.built).toHaveLength(2);
});

test("with no fixtures anywhere passes without building a judge", async () => {
  await config("rules:\n  - id: plain\n    files: ['**/*.ts']\n    standard: Plain\n");
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "test", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("\n0 fixtures, 0 misclassified\n");
  expect(fake.built).toEqual([]);
});

test("uses the rule's llm override and sends its context", async () => {
  await config(`rules:\n${RULE}    llm: { model: other }\n    context: [docs/style.md]\n`);
  await fixtures();
  await write(dir(), "docs/style.md", "# Style\n");
  const fake = fakeJudge({
    "fixtures/bad.ts": noul(0.1, "no"),
    "fixtures/worse.ts": noul(0.1, "no"),
  });
  const result = await lawbookWith(fake.deps, "test", dir());
  expect(result.code).toBe(0);
  expect(fake.built).toMatchObject([{ model: "other" }]);
  expect(fake.requests[0]?.context).toEqual([{ path: "docs/style.md", content: "# Style\n" }]);
});

test("reuses the verdict cache and --no-cache bypasses it", async () => {
  await config(`rules:\n${RULE}`);
  await fixtures();
  const cacheDir = path.join(dir(), "cache");
  const fake = fakeJudge({
    "fixtures/bad.ts": noul(0.1, "no"),
    "fixtures/worse.ts": noul(0.1, "no"),
  });
  await lawbookWith(fake.deps, "test", dir(), "--cache-dir", cacheDir);
  expect((await readdir(cacheDir)).length).toBe(3);
  await lawbookWith(fake.deps, "test", dir(), "--cache-dir", cacheDir);
  expect(fake.requests).toHaveLength(3);
  await lawbookWith(fake.deps, "test", dir(), "--cache-dir", cacheDir, "--no-cache");
  expect(fake.requests).toHaveLength(6);
});

test("a provider error during test exits two with its message", async () => {
  await config(`rules:\n${RULE}`);
  await fixtures();
  const fake = fakeJudge();
  fake.judge.judge = () => Promise.reject(new CliError("bedrock: 401 invalid x-api-key"));
  const result = await lawbookWith(fake.deps, "test", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("error: bedrock: 401 invalid x-api-key\n");
});

test("fixtures on a forbid rule are rejected", async () => {
  await config(
    "rules:\n  - id: no-todo\n    files: ['**/*.ts']\n    forbid: TODO\n    fixtures: { fail: [a.ts] }\n",
  );
  const result = await lawbook("check", dir());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("rules[0]");
});

test("help lists its format choices", async () => {
  const result = await lawbook("test", "--help");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('"text"');
  expect(result.stdout).toContain('"json"');
  expect(result.stdout).not.toContain('"sarif"');
});
