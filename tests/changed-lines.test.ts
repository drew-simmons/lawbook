import path from "node:path";
import { expect, test } from "vitest";
import { usageTotals } from "./helpers.ts";
import {
  fakeJudge,
  gitIn,
  gitRepo,
  lawbook,
  lawbookWith,
  noul,
  useTempDir,
  write,
} from "./helpers.ts";

const dir = useTempDir();

const STANDARD = "Errors say what to do next";

async function config(extra = ""): Promise<void> {
  await write(
    dir(),
    "lawbook.yaml",
    `version: 1\nrules:\n  - id: actionable-errors\n    files: ['**/*.ts']\n    standard: ${STANDARD}\n${extra}`,
  );
}

const A_BEFORE = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
const A_AFTER = "const a = 1;\nconst B = 2;\nconst c = 3;\nconst d = 4;\n";
const B = "const b = 1;\nconst b2 = 2;\n";

/** A branch off `main` that changes two lines of `a.ts`, adds `b.ts`, and leaves `c.ts` alone. */
async function featureBranch(): Promise<void> {
  await config();
  await write(dir(), "a.ts", A_BEFORE);
  await write(dir(), "c.ts", "const c = 1;\n");
  await gitRepo(dir());
  await gitIn(dir(), "switch", "-q", "-c", "feature");
  await write(dir(), "a.ts", A_AFTER);
  await write(dir(), "b.ts", B);
  await gitIn(dir(), "add", "-A");
  await gitIn(dir(), "commit", "-q", "-m", "feature");
}

const A_CHANGED = [
  { start: 2, end: 2 },
  { start: 4, end: 4 },
];

test("--changed-lines without --changed or --since exits two", async () => {
  await config();
  await gitRepo(dir());
  const result = await lawbook("check", dir(), "--changed-lines");
  expect(result.code).toBe(2);
  expect(result.stderr).toBe(
    "error: --changed-lines needs --changed or --since to say which lines changed\n",
  );
});

test("--since --changed-lines sends each changed file with the lines the commits touched", async () => {
  await featureBranch();
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir(), "--since", "main", "--changed-lines");
  expect(result.code).toBe(0);
  expect(fake.requests).toEqual([
    {
      standard: STANDARD,
      files: [{ path: "a.ts", content: A_AFTER }],
      changed: { "a.ts": A_CHANGED },
    },
    {
      standard: STANDARD,
      files: [{ path: "b.ts", content: B }],
      changed: { "b.ts": [{ start: 1, end: 2 }] },
    },
  ]);
});

test("a finding on a changed line is reported with its line; one outside the change is dropped and counted", async () => {
  await featureBranch();
  const fake = fakeJudge({
    "a.ts": { ...noul(0.1, "line 3 names no next step"), line: 3 },
    "b.ts": { ...noul(0.2, "line 1 names no next step"), line: 1 },
  });
  const result = await lawbookWith(fake.deps, "check", dir(), "--since", "main", "--changed-lines");
  expect(result.code).toBe(1);
  expect(result.stdout).toContain(
    "FAIL actionable-errors\n  b.ts:1: line 1 names no next step (noul 0.20)\n  1 finding outside the change\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("a rule whose only findings lie outside the change passes, and JSON counts them per rule and in the summary", async () => {
  await featureBranch();
  const fake = fakeJudge({ "a.ts": { ...noul(0.1, "line 3 names no next step"), line: 3 } });
  const result = await lawbookWith(
    fake.deps,
    "check",
    dir(),
    "--since",
    "main",
    "--changed-lines",
    "--format",
    "json",
  );
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    results: [
      {
        id: "actionable-errors",
        kind: "standard",
        level: "error",
        status: "pass",
        findings: [],
        decisions: { "a.ts": { type: "noul", noul: 0.1 }, "b.ts": { type: "noul", noul: 1 } },
        usage: usageTotals(2),
        outside: 1,
      },
    ],
    summary: {
      passed: 1,
      failed: 0,
      warned: 0,
      errored: 0,
      skipped: 0,
      usage: usageTotals(2),
      outside: 1,
    },
  });
});

test("a finding that cites no line stays, since nothing says it lies outside", async () => {
  await featureBranch();
  const fake = fakeJudge({ "a.ts": noul(0.1, "names no next step") });
  const result = await lawbookWith(fake.deps, "check", dir(), "--since", "main", "--changed-lines");
  expect(result.code).toBe(1);
  expect(result.stdout).toContain(
    "FAIL actionable-errors\n  a.ts: names no next step (noul 0.10)\n\n",
  );
});

test("without --changed-lines a line the model gives is not carried into the finding", async () => {
  await featureBranch();
  const fake = fakeJudge({ "a.ts": { ...noul(0.1, "names no next step"), line: 2 } });
  const result = await lawbookWith(fake.deps, "check", dir(), "--since", "main");
  expect(result.stdout).toContain(
    "FAIL actionable-errors\n  a.ts: names no next step (noul 0.10)\n\n",
  );
  expect(fake.requests[0]).not.toHaveProperty("changed");
});

test("a candidate with no changed lines costs no request, in the run and in the plan", async () => {
  await featureBranch();
  const fake = fakeJudge();
  const args = [
    "check",
    dir(),
    "--since",
    "main",
    "--changed-lines",
    "--files",
    path.join(dir(), "c.ts"),
  ];
  const result = await lawbookWith(fake.deps, ...args);
  expect(result.code).toBe(0);
  expect(fake.requests.map((request) => request.files[0]?.path)).toEqual(["a.ts", "b.ts"]);
  const plan = await lawbook(...args, "--dry-run");
  expect(plan.stdout).toBe(
    "PLAN actionable-errors (standard, 2 files)\n  a.ts\n  b.ts\n\n2 files, 2 model requests\n",
  );
});

test("--changed --changed-lines judges an untracked file in full and a tracked one on its new lines", async () => {
  await config();
  await write(dir(), "a.ts", A_BEFORE);
  await gitRepo(dir());
  await write(dir(), "a.ts", `${A_BEFORE}const d = 4;\n`);
  await write(dir(), "new.ts", B);
  const fake = fakeJudge({ "new.ts": { ...noul(0.1, "names no next step"), line: 2 } });
  const result = await lawbookWith(fake.deps, "check", dir(), "--changed", "--changed-lines");
  expect(result.code).toBe(1);
  expect(fake.requests.map((request) => request.changed)).toEqual([
    { "a.ts": [{ start: 4, end: 4 }] },
    { "new.ts": [{ start: 1, end: 2 }] },
  ]);
  expect(result.stdout).toContain("  new.ts:2: names no next step (noul 0.10)\n");
});

test("a set rule sends every changed file's lines in its one request and keeps the set's finding", async () => {
  await featureBranch();
  await config("    scope: set\n");
  const fake = fakeJudge({ "a.ts,b.ts": { ...noul(0.1, "the set names no next step"), line: 3 } });
  const result = await lawbookWith(fake.deps, "check", dir(), "--since", "main", "--changed-lines");
  expect(result.code).toBe(1);
  expect(fake.requests[0]?.changed).toEqual({ "a.ts": A_CHANGED, "b.ts": [{ start: 1, end: 2 }] });
  expect(result.stdout).toContain(
    "FAIL actionable-errors\n  the set names no next step (noul 0.10)\n\n",
  );
});

test("--changed-lines leaves deterministic rules as they are", async () => {
  await featureBranch();
  await write(
    dir(),
    "lawbook.yaml",
    "version: 1\nrules:\n  - id: no-c\n    files: ['**/*.ts']\n    forbid: 'const c'\n",
  );
  const result = await lawbook("check", dir(), "--since", "main", "--changed-lines");
  expect(result.stdout).toBe(
    "FAIL no-c\n  a.ts:3: const c = 3;\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});
