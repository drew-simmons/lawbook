import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { applyBaseline, buildBaseline, parseBaseline } from "../src/baseline.ts";
import { CliError } from "../src/errors.ts";
import { summarize } from "../src/result.ts";
import { fakeJudge, lawbook, lawbookWith, noul, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

const NO_TODO = "  - id: no-todo\n    files: ['**/*.ts']\n    forbid: 'TODO'\n";
const HEADER = "  - id: header\n    files: ['**/*.ts']\n    require: 'Copyright'\n";
const STANDARD =
  "  - id: actionable-errors\n    files: ['**/*.ts']\n    standard: Errors say what to do next\n";

async function config(rules: string): Promise<void> {
  await write(dir(), "lawbook.yaml", `version: 1\nrules:\n${rules}`);
}

function baselineFile(): string {
  return path.join(dir(), "lawbook-baseline.json");
}

test("--update-baseline writes every finding, hides them, and exits zero", async () => {
  await config(NO_TODO + HEADER);
  await write(dir(), "a.ts", "// TODO one\n// TODO two\n// TODO one\n");
  await write(dir(), "b.ts", "// Copyright\n// TODO one\n");
  const result = await lawbook("check", dir(), "--baseline", baselineFile(), "--update-baseline");
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    "PASS no-todo\n  4 findings in baseline\nPASS header\n  1 finding in baseline\n\n2 passed, 0 failed, 0 warned, 0 errored, 0 skipped\n",
  );
  expect(JSON.parse(await readFile(baselineFile(), "utf8"))).toEqual({
    version: 1,
    findings: [
      { rule: "header", path: "a.ts", count: 1 },
      { rule: "no-todo", path: "a.ts", message: "// TODO one", count: 2 },
      { rule: "no-todo", path: "a.ts", message: "// TODO two", count: 1 },
      { rule: "no-todo", path: "b.ts", message: "// TODO one", count: 1 },
    ],
  });
});

test("--baseline hides recorded findings and new ones still fail", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "// TODO one\n");
  await lawbook("check", dir(), "--baseline", baselineFile(), "--update-baseline");
  await write(dir(), "a.ts", "const x = 1;\n// TODO one\n// TODO new\n");
  const result = await lawbook("check", dir(), "--baseline", baselineFile());
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "FAIL no-todo\n  a.ts:3: // TODO new\n  1 finding in baseline\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("a baseline hides only as many identical findings as it recorded", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "// TODO\n");
  await lawbook("check", dir(), "--baseline", baselineFile(), "--update-baseline");
  await write(dir(), "a.ts", "// TODO\n// TODO\n");
  const result = await lawbook("check", dir(), "--baseline", baselineFile());
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("FAIL no-todo\n  a.ts:2: // TODO\n  1 finding in baseline\n");
});

test("--baseline with --format json carries the baselined count", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "// TODO\n");
  await lawbook("check", dir(), "--baseline", baselineFile(), "--update-baseline");
  const result = await lawbook("check", dir(), "--baseline", baselineFile(), "--format", "json");
  expect(result.code).toBe(0);
  const [rule] = JSON.parse(result.stdout).results;
  expect(rule).toMatchObject({ status: "pass", findings: [], baselined: 1 });
});

test("a baselined standard finding is hidden but a provider error is not", async () => {
  await config(STANDARD);
  await write(dir(), "a.ts", "throw new Error('bad');\n");
  await write(dir(), "b.ts", "throw new Error('worse');\n");
  const fake = fakeJudge({ "a.ts": noul(0.1, "no next step"), "b.ts": noul(0.2, "none") });
  const first = await lawbookWith(
    fake.deps,
    "check",
    dir(),
    "--no-cache",
    "--baseline",
    baselineFile(),
    "--update-baseline",
  );
  expect(first.code).toBe(0);
  expect(first.stdout).toContain("PASS actionable-errors\n  2 findings in baseline\n");
  fake.judge.judge = (request) =>
    request.files[0]?.path === "b.ts"
      ? Promise.reject(new CliError("bedrock: 503 unavailable"))
      : Promise.resolve(noul(0.1, "worded differently"));
  const second = await lawbookWith(
    fake.deps,
    "check",
    dir(),
    "--no-cache",
    "--baseline",
    baselineFile(),
  );
  expect(second.code).toBe(2);
  expect(second.stdout).toContain(
    "ERROR actionable-errors\n  b.ts: bedrock: 503 unavailable\n  1 finding in baseline\n",
  );
});

test("--update-baseline without --baseline exits two", async () => {
  await config(NO_TODO);
  const result = await lawbook("check", dir(), "--update-baseline");
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("error: --update-baseline needs --baseline <file> to write to\n");
});

test("--baseline with a missing file exits two", async () => {
  await config(NO_TODO);
  const result = await lawbook("check", dir(), "--baseline", baselineFile());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(`error: cannot read baseline ${baselineFile()}:`);
});

test("--baseline with an invalid file exits two naming it", async () => {
  await config(NO_TODO);
  await write(dir(), "lawbook-baseline.json", '{"version": 2, "findings": []}');
  const result = await lawbook("check", dir(), "--baseline", baselineFile());
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(`error: ${baselineFile()}:`);
  expect(result.stderr).toContain("version");
  const broken = await write(dir(), "lawbook-baseline.json", "{nope");
  expect(broken).toBeUndefined();
  const result2 = await lawbook("check", dir(), "--baseline", baselineFile());
  expect(result2.code).toBe(2);
  expect(result2.stderr).toContain(`error: ${baselineFile()}:`);
});

test("--update-baseline to an unwritable path exits two", async () => {
  await config(NO_TODO);
  const file = path.join(dir(), "missing", "baseline.json");
  const result = await lawbook("check", dir(), "--baseline", file, "--update-baseline");
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(`error: cannot write baseline ${file}:`);
});

test("a set-scope finding is keyed by its rule alone and a warn rule keeps warning", () => {
  const report = summarize([
    {
      id: "set",
      kind: "standard",
      level: "warn",
      status: "warn",
      findings: [{ message: "too loose", decision: { type: "noul", noul: 0.2 } }],
    },
  ]);
  const baseline = buildBaseline(report);
  expect(baseline.findings).toEqual([{ rule: "set", count: 1 }]);
  const applied = applyBaseline(report, baseline);
  expect(applied.results[0]).toMatchObject({ status: "pass", findings: [], baselined: 1 });
  const again = applyBaseline(
    summarize([
      {
        ...report.results[0]!,
        findings: [...report.results[0]!.findings, ...report.results[0]!.findings],
      },
    ]),
    baseline,
  );
  expect(again.results[0]).toMatchObject({ status: "warn", baselined: 1 });
  expect(again.summary.warned).toBe(1);
});

test("parseBaseline rejects unknown keys", () => {
  expect(() => parseBaseline("b.json", '{"version":1,"findings":[],"extra":1}')).toThrow(CliError);
});
