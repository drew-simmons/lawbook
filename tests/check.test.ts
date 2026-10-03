import { expect, test } from "vitest";
import { lawbook, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

async function config(rules: string): Promise<void> {
  await write(dir(), "lawbook.yaml", `version: 1\nrules:\n${rules}`);
}

test("forbid fails with path and line", async () => {
  await config("  - id: no-todo\n    files: ['**/*.ts']\n    forbid: 'TODO'\n");
  await write(dir(), "src/a.ts", "const a = 1;\n// TODO later\n");
  await write(dir(), "src/b.ts", "// TODO first\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "FAIL no-todo\n  src/a.ts:2: // TODO later\n  src/b.ts:1: // TODO first\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("forbid passes when no line matches", async () => {
  await config("  - id: no-todo\n    files: ['**/*.ts']\n    forbid: 'TODO'\n");
  await write(dir(), "src/a.ts", "const a = 1;\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    "PASS no-todo\n\n1 passed, 0 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("forbid with no selected files passes", async () => {
  await config("  - id: no-todo\n    files: ['**/*.ts']\n    forbid: 'TODO'\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("PASS no-todo\n");
});

test("forbid anchors match line starts", async () => {
  await config("  - id: no-bare-export\n    files: ['**/*.ts']\n    forbid: '^export default'\n");
  await write(dir(), "a.ts", "const x = 1;\nexport default x;\n");
  const result = await lawbook("check", dir());
  expect(result.stdout).toContain("  a.ts:2: export default x;\n");
});

test("require fails listing files without a match", async () => {
  await config("  - id: header\n    files: ['**/*.ts']\n    require: '^// Copyright'\n");
  await write(dir(), "a.ts", "// Copyright\n");
  await write(dir(), "b.ts", "const b = 1;\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "FAIL header\n  b.ts: does not match /^// Copyright/\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("require passes when every file matches", async () => {
  await config("  - id: header\n    files: ['**/*.ts']\n    require: 'Copyright'\n");
  await write(dir(), "a.ts", "// Copyright\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("PASS header\n");
});

test("exists passes when the path is present", async () => {
  await config("  - id: readme\n    exists: README.md\n");
  await write(dir(), "README.md", "# hi\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("PASS readme\n");
});

test("exists fails when the path is missing", async () => {
  await config("  - id: readme\n    exists: README.md\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("FAIL readme\n  README.md: missing\n");
});

test("absent passes when the path is missing", async () => {
  await config("  - id: no-env\n    absent: .env\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("PASS no-env\n");
});

test("absent fails when the path is present", async () => {
  await config("  - id: no-env\n    absent: .env\n");
  await write(dir(), ".env", "SECRET=1\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("FAIL no-env\n  .env: exists\n");
});

test("check exits one when any rule fails and reports all of them", async () => {
  await config("  - id: no-env\n    absent: .env\n  - id: readme\n    exists: README.md\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "PASS no-env\nFAIL readme\n  README.md: missing\n\n1 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("check --format json emits results and summary", async () => {
  await config("  - id: readme\n    exists: README.md\n");
  const result = await lawbook("check", dir(), "--format", "json");
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toEqual({
    results: [
      {
        id: "readme",
        kind: "exists",
        level: "error",
        status: "fail",
        findings: [{ path: "README.md", message: "missing" }],
      },
    ],
    summary: { passed: 0, failed: 1, warned: 0, errored: 0, skipped: 0 },
  });
});

test("a warn rule with findings prints WARN and exits zero", async () => {
  await config("  - id: no-todo\n    level: warn\n    files: ['**/*.ts']\n    forbid: 'TODO'\n");
  await write(dir(), "src/a.ts", "// TODO later\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    "WARN no-todo\n  src/a.ts:1: // TODO later\n\n0 passed, 0 failed, 1 warned, 0 errored, 0 skipped\n",
  );
});

test("a warn rule without findings passes", async () => {
  await config("  - id: no-todo\n    level: warn\n    files: ['**/*.ts']\n    forbid: 'TODO'\n");
  await write(dir(), "src/a.ts", "const a = 1;\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    "PASS no-todo\n\n1 passed, 0 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("a failing error rule beside a warn rule still exits one", async () => {
  await config(
    "  - id: no-env\n    level: warn\n    absent: .env\n  - id: readme\n    exists: README.md\n",
  );
  await write(dir(), ".env", "SECRET=1\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "WARN no-env\n  .env: exists\nFAIL readme\n  README.md: missing\n\n0 passed, 1 failed, 1 warned, 0 errored, 0 skipped\n",
  );
});

test("check --format json carries each rule's level", async () => {
  await config(
    "  - id: no-env\n    level: warn\n    absent: .env\n  - id: readme\n    exists: README.md\n",
  );
  await write(dir(), ".env", "SECRET=1\n");
  const result = await lawbook("check", dir(), "--format", "json");
  expect(JSON.parse(result.stdout)).toEqual({
    results: [
      {
        id: "no-env",
        kind: "absent",
        level: "warn",
        status: "warn",
        findings: [{ path: ".env", message: "exists" }],
      },
      {
        id: "readme",
        kind: "exists",
        level: "error",
        status: "fail",
        findings: [{ path: "README.md", message: "missing" }],
      },
    ],
    summary: { passed: 0, failed: 1, warned: 1, errored: 0, skipped: 0 },
  });
});

test("check --format with an unknown format exits two", async () => {
  await config("  - id: no-env\n    absent: .env\n");
  const result = await lawbook("check", dir(), "--format", "xml");
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("xml");
});

test("check --only runs the named rules", async () => {
  await config(
    "  - id: a\n    absent: .env\n  - id: b\n    exists: README.md\n  - id: c\n    absent: .git\n",
  );
  const result = await lawbook("check", dir(), "--only", "c", "a");
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    "PASS a\nPASS c\n\n2 passed, 0 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("check --only with an unknown id exits two", async () => {
  await config("  - id: a\n    absent: .env\n");
  const result = await lawbook("check", dir(), "--only", "a", "nope", "nah");
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("error: unknown rule id: nope, nah\n");
});

test("check ignores node_modules and .git by default", async () => {
  await config("  - id: no-todo\n    files: ['**/*.ts']\n    forbid: 'TODO'\n");
  await write(dir(), "node_modules/dep/index.ts", "// TODO\n");
  await write(dir(), ".git/hooks/x.ts", "// TODO\n");
  await write(dir(), ".hidden/x.ts", "// TODO\n");
  const result = await lawbook("check", dir());
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "FAIL no-todo\n  .hidden/x.ts:1: // TODO\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("check honors a custom ignore list", async () => {
  await write(
    dir(),
    "lawbook.yaml",
    "version: 1\nignore: ['vendor/**']\nrules:\n  - id: no-todo\n    files: ['**/*.ts']\n    forbid: 'TODO'\n",
  );
  await write(dir(), "vendor/x.ts", "// TODO\n");
  await write(dir(), "node_modules/x.ts", "// TODO\n");
  const result = await lawbook("check", dir());
  expect(result.stdout).toBe(
    "FAIL no-todo\n  node_modules/x.ts:1: // TODO\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("check defaults the root to the current directory", async () => {
  const result = await lawbook("check");
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("found in .;");
});
