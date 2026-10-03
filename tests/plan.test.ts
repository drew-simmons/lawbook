import path from "node:path";
import { expect, test } from "vitest";
import { fakeJudge, lawbook, lawbookWith, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

const RULES =
  "  - id: no-todo\n    files: ['**/*.ts']\n    forbid: TODO\n  - id: readme\n    exists: README.md\n  - id: actionable-errors\n    files: ['**/*.ts']\n    standard: Errors say what to do next\n";

async function config(rules = RULES): Promise<void> {
  await write(dir(), "lawbook.yaml", `version: 1\nrules:\n${rules}`);
  await write(dir(), "src/a.ts", "// TODO\n");
  await write(dir(), "src/b.ts", "const b = 1;\n");
}

const TEXT =
  "PLAN no-todo (forbid, 2 files)\n  src/a.ts\n  src/b.ts\nPLAN readme (exists, 1 file)\n  README.md\nPLAN actionable-errors (standard, 2 files)\n  src/a.ts\n  src/b.ts\n\n3 files, 2 model requests\n";

test("--dry-run lists each rule's files in config order and builds no judge", async () => {
  await config();
  const fake = fakeJudge();
  const result = await lawbookWith(fake.deps, "check", dir(), "--dry-run");
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(TEXT);
  expect(fake.built).toEqual([]);
  expect(fake.requests).toEqual([]);
});

test("--dry-run counts zero model requests under --no-llm", async () => {
  await config();
  const result = await lawbook("check", dir(), "--dry-run", "--no-llm");
  expect(result.stdout).toContain("\n3 files, 0 model requests\n");
});

test("--dry-run --format json prints the plan", async () => {
  await config();
  const result = await lawbook(
    "check",
    dir(),
    "--dry-run",
    "--format",
    "json",
    "--only",
    "readme",
    "no-todo",
  );
  expect(JSON.parse(result.stdout)).toEqual({
    rules: [
      { id: "no-todo", kind: "forbid", level: "error", files: ["src/a.ts", "src/b.ts"] },
      { id: "readme", kind: "exists", level: "error", files: ["README.md"] },
    ],
    requests: 0,
  });
});

test("--dry-run honours --files and a rule's exclude", async () => {
  await config(
    "  - id: no-todo\n    files: ['**/*.ts']\n    exclude: ['src/b.ts']\n    forbid: TODO\n",
  );
  const result = await lawbook(
    "check",
    dir(),
    "--dry-run",
    "--files",
    path.join(dir(), "src/b.ts"),
    path.join(dir(), "src/a.ts"),
  );
  expect(result.stdout).toBe(
    "PLAN no-todo (forbid, 1 file)\n  src/a.ts\n\n1 file, 0 model requests\n",
  );
});

test("--dry-run lists a binary file, since nothing is read", async () => {
  await config("  - id: no-todo\n    files: ['**/*.bin']\n    forbid: TODO\n");
  await write(dir(), "x.bin", "TODO\0");
  const result = await lawbook("check", dir(), "--dry-run");
  expect(result.stdout).toContain("  x.bin\n");
});

test("--dry-run with an annotation format exits two", async () => {
  await config();
  const result = await lawbook("check", dir(), "--dry-run", "--format", "github");
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("error: --dry-run prints text or json, not github\n");
});

test("--dry-run with an unknown --only id exits two", async () => {
  await config();
  const result = await lawbook("check", dir(), "--dry-run", "--only", "nope");
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("error: unknown rule id: nope\n");
});
