import path from "node:path";
import { expect, test } from "vitest";
import { gitIn, gitRepo, lawbook, useTempDir, write } from "./helpers.ts";

const dir = useTempDir();

const NO_TODO = "  - id: no-todo\n    files: ['**/*.ts']\n    forbid: 'TODO'\n";

async function config(rules: string, root = dir()): Promise<void> {
  await write(root, "lawbook.yaml", `version: 1\nrules:\n${rules}`);
}

/** The absolute path of `relative` under the temp dir. */
const abs = (relative: string) => path.join(dir(), relative);

test("--files limits files rules to the named files", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "// TODO a\n");
  await write(dir(), "b.ts", "// TODO b\n");
  const result = await lawbook("check", dir(), "--files", abs("a.ts"));
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "FAIL no-todo\n  a.ts:1: // TODO a\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("--files resolves paths relative to the current directory", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "// TODO a\n");
  const relative = path.relative(process.cwd(), abs("a.ts"));
  const result = await lawbook("check", dir(), "--files", relative);
  expect(result.stdout).toContain("  a.ts:1: // TODO a\n");
});

test("--files drops paths outside the root and files no rule selects", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "// TODO a\n");
  await write(dir(), "c.md", "TODO\n");
  const result = await lawbook("check", dir(), "--files", abs("../x.ts"), abs("c.md"));
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    "PASS no-todo\n\n1 passed, 0 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("--files leaves exists and absent rules alone", async () => {
  await config(
    `${NO_TODO}  - id: readme\n    exists: README.md\n  - id: no-env\n    absent: .env\n`,
  );
  await write(dir(), ".env", "SECRET=1\n");
  const result = await lawbook("check", dir(), "--files", abs("a.ts"));
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "PASS no-todo\nFAIL readme\n  README.md: missing\nFAIL no-env\n  .env: exists\n\n1 passed, 2 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("--changed checks staged, unstaged, and untracked files but not unchanged ones", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "const a = 1;\n");
  await write(dir(), "d.ts", "// TODO d\n");
  await gitRepo(dir());
  await write(dir(), "a.ts", "// TODO a\n");
  await write(dir(), "b.ts", "// TODO b\n");
  await gitIn(dir(), "add", "b.ts");
  await write(dir(), "c.ts", "// TODO c\n");
  const result = await lawbook("check", dir(), "--changed");
  expect(result.code).toBe(1);
  expect(result.stdout).toBe(
    "FAIL no-todo\n  a.ts:1: // TODO a\n  b.ts:1: // TODO b\n  c.ts:1: // TODO c\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("--changed rebases git paths onto a root below the repository's top level", async () => {
  const root = abs("packages/app");
  await config("  - id: no-todo\n    files: ['**/*.{ts,md}']\n    forbid: 'TODO'\n", root);
  await write(root, "x.ts", "const x = 1;\n");
  await write(dir(), "y.md", "fine\n");
  await gitRepo(dir());
  await write(root, "x.ts", "// TODO x\n");
  await write(dir(), "y.md", "TODO y\n");
  const result = await lawbook("check", root, "--changed");
  expect(result.stdout).toBe(
    "FAIL no-todo\n  x.ts:1: // TODO x\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("--since checks files committed since the merge base, not the working tree", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "// TODO a\n");
  await gitRepo(dir());
  await gitIn(dir(), "switch", "-q", "-c", "feature");
  await write(dir(), "b.ts", "// TODO b\n");
  await gitIn(dir(), "add", "-A");
  await gitIn(dir(), "commit", "-q", "-m", "b");
  await gitIn(dir(), "switch", "-q", "main");
  await write(dir(), "c.ts", "// TODO c\n");
  await gitIn(dir(), "add", "-A");
  await gitIn(dir(), "commit", "-q", "-m", "c");
  await gitIn(dir(), "switch", "-q", "feature");
  await write(dir(), "e.ts", "// TODO e\n");
  const result = await lawbook("check", dir(), "--since", "main");
  expect(result.stdout).toBe(
    "FAIL no-todo\n  b.ts:1: // TODO b\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("--changed and --files combine", async () => {
  await config(NO_TODO);
  await write(dir(), "a.ts", "// TODO a\n");
  await write(dir(), "b.ts", "// TODO b\n");
  await write(dir(), "c.ts", "// TODO c\n");
  await gitRepo(dir());
  await write(dir(), "c.ts", "// TODO c!\n");
  const result = await lawbook("check", dir(), "--changed", "--files", abs("a.ts"));
  expect(result.stdout).toBe(
    "FAIL no-todo\n  a.ts:1: // TODO a\n  c.ts:1: // TODO c!\n\n0 passed, 1 failed, 0 warned, 0 errored, 0 skipped\n",
  );
});

test("--changed outside a git repository exits two", async () => {
  await config(NO_TODO);
  const result = await lawbook("check", dir(), "--changed");
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(/^error: git rev-parse: .*not a git repository/u);
});

test("--since with an unknown ref exits two naming the ref", async () => {
  await config(NO_TODO);
  await gitRepo(dir());
  const result = await lawbook("check", dir(), "--since", "nope");
  expect(result.code).toBe(2);
  expect(result.stderr).toMatch(/^error: git diff: /u);
  expect(result.stderr).toContain("nope");
});
